"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeployingMicoserviceOnEksStack = void 0;
const cdk = require("aws-cdk-lib");
const eks = require("aws-cdk-lib/aws-eks");
const iam = require("aws-cdk-lib/aws-iam");
const fs = require("fs");
const yaml = require("yaml");
const path = require("path");
const lambda_layer_kubectl_v28_1 = require("@aws-cdk/lambda-layer-kubectl-v28");
const ec2 = require("aws-cdk-lib/aws-ec2");
class DeployingMicoserviceOnEksStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const envconfigs = this.node.tryGetContext('envconfigs');
        const iamroleforcluster = new iam.Role(this, 'EksAdminRole', {
            assumedBy: new iam.AccountRootPrincipal(),
        });
        const vpc = new ec2.Vpc(this, 'Vpc', {
            natGateways: 1,
            subnetConfiguration: [
                {
                    name: 'PrivateSubnet',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: 24,
                },
                {
                    name: 'PublicSubnet',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
            ],
        });
        const cluster = new eks.Cluster(this, 'EksCluster', {
            clusterName: 'EksCluster',
            defaultCapacity: 0,
            vpc,
            version: eks.KubernetesVersion.V1_28,
            kubectlLayer: new lambda_layer_kubectl_v28_1.KubectlV28Layer(this, 'kubectl'),
            vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
            mastersRole: iamroleforcluster,
        });
        const nodegroup = cluster.addNodegroupCapacity('NodeGroup', {
            desiredSize: 2,
            instanceTypes: [new ec2.InstanceType('t3.medium')],
            remoteAccess: {
                sshKeyName: 'demo',
            },
        });
        nodegroup.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
        cluster.awsAuth.addRoleMapping(nodegroup.role, {
            username: 'system:node:{{EC2PrivateDNSName}}',
            groups: ['system:bootstrappers', 'system:nodes', 'system:masters'],
        });
        cluster.addHelmChart('MetricsServer', {
            chart: 'metrics-server',
            repository: 'https://kubernetes-sigs.github.io/metrics-server/',
            release: 'metrics-server',
            namespace: 'kube-system',
            values: {
                args: [
                    '--kubelet-insecure-tls',
                    '--kubelet-preferred-address-types=InternalIP,Hostname,ExternalIP',
                ],
            },
        });
        const namespaceManifestPath = path.join(__dirname, '..', 'manifests', 'namespace-cloudwatch.yaml');
        const namespaceManifestContent = fs.readFileSync(namespaceManifestPath, 'utf8');
        const namespaceDocs = yaml.parseAllDocuments(namespaceManifestContent);
        const namespaceResources = namespaceDocs.map((doc) => doc.toJSON()).filter(Boolean);
        const cloudwatchNamespace = cluster.addManifest('CloudWatchNamespace', ...namespaceResources);
        const conditionJson = new cdk.CfnJson(this, 'OIDCCondition', {
            value: {
                [`${cluster.openIdConnectProvider.openIdConnectProviderIssuer}:sub`]: 'system:serviceaccount:amazon-cloudwatch:fluent-bit',
            },
        });
        const fluentBitSaRole = new iam.Role(this, 'FluentBitIRSA', {
            assumedBy: new iam.WebIdentityPrincipal(cluster.openIdConnectProvider.openIdConnectProviderArn, {
                StringEquals: conditionJson,
            }),
        });
        fluentBitSaRole.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
                'logs:DescribeLogStreams',
            ],
            resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/eks/*`],
        }));
        const valuesYamlPath = path.join(__dirname, '..', 'manifests', 'values.yaml');
        const valuesYamlContent = fs.readFileSync(valuesYamlPath, 'utf8');
        const values = yaml.parse(valuesYamlContent);
        const manifestsDir = 'manifests';
        const files = [
            'namespace.yaml',
            'rolebinding.yaml',
            'configMap-secret.yaml',
            'deployment.yaml',
            'HPA.yaml',
            'job.yaml',
        ];
        let previousHelmChart = undefined;
        for (const envName of Object.keys(envconfigs)) {
            const config = envconfigs[envName];
            const placeholders = {
                '{{ENV}}': envName,
                '{{APP_VERSION}}': config.appVersion || '1.0.0',
                '{{REPLICA_COUNT}}': (config.replicaCount || 1).toString(),
                '{{REQUEST_CPU}}': config.requestCpu || '100m',
                '{{LIMIT_CPU}}': config.limitCpu || '200m',
                '{{FEATURE_FLAG}}': config.featureFlag === undefined ? 'false' : config.featureFlag.toString(),
                '{{LOG_GROUP_NAME}}': `/eks/${envName}/app-logs`, // Dynamic log group name
            };
            const replacePlaceholders = (content) => {
                for (const [key, value] of Object.entries(placeholders)) {
                    content = content.replace(new RegExp(key, 'g'), value);
                }
                return content;
            };
            const allResources = files.flatMap((file) => {
                const content = replacePlaceholders(fs.readFileSync(path.join(manifestsDir, file), 'utf8'));
                return yaml.parseAllDocuments(content).map((doc) => doc.toJSON()).filter(Boolean);
            });
            const namespaceResources = allResources.filter((res) => res.kind === 'Namespace');
            const otherResources = allResources.filter((res) => res.kind !== 'Namespace');
            const namespaceManifest = cluster.addManifest(`NamespaceManifest-${envName}`, ...namespaceResources);
            const appManifest = cluster.addManifest(`AppManifests-${envName}`, ...otherResources);
            appManifest.node.addDependency(namespaceManifest);
            const fluentBit = cluster.addHelmChart(`FluentBit-${envName}`, {
                chart: 'aws-for-fluent-bit',
                repository: 'https://aws.github.io/eks-charts',
                release: `fluent-bit-${envName}`,
                namespace: 'amazon-cloudwatch',
                createNamespace: false,
                values: {
                    ...values,
                    serviceAccount: {
                        name: 'fluent-bit',
                        annotations: {
                            'eks.amazonaws.com/role-arn': fluentBitSaRole.roleArn,
                        },
                    },
                },
            });
            fluentBit.node.addDependency(cloudwatchNamespace);
            if (previousHelmChart) {
                fluentBit.node.addDependency(previousHelmChart);
            }
            previousHelmChart = fluentBit;
        }
    }
}
exports.DeployingMicoserviceOnEksStack = DeployingMicoserviceOnEksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLDZCQUE2QjtBQUM3QixnRkFBb0U7QUFDcEUsMkNBQTJDO0FBRTNDLE1BQWEsOEJBQStCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDM0QsWUFBWSxLQUFlLEVBQUUsRUFBUyxFQUFFLEtBQXFCO1FBQUcsS0FBSyxDQUFDLEtBQUssRUFBQyxFQUFFLEVBQUMsS0FBSyxDQUFDLENBQUM7UUFHcEYsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFekQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsb0JBQW9CLEVBQUU7U0FDMUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDbkMsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkI7b0JBQ0UsSUFBSSxFQUFFLGVBQWU7b0JBQ3JCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtvQkFDOUMsUUFBUSxFQUFFLEVBQUU7aUJBQ2I7Z0JBQ0Q7b0JBQ0UsSUFBSSxFQUFFLGNBQWM7b0JBQ3BCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07b0JBQ2pDLFFBQVEsRUFBRSxFQUFFO2lCQUNiO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCxNQUFNLE9BQU8s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ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBla3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVrcyc7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xyXG5pbXBvcnQgKiBhcyB5YW1sIGZyb20gJ3lhbWwnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgeyBLdWJlY3RsVjI4TGF5ZXIgfSBmcm9tICdAYXdzLWNkay9sYW1iZGEtbGF5ZXIta3ViZWN0bC12MjgnO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcblxyXG5leHBvcnQgY2xhc3MgRGVwbG95aW5nTWljb3NlcnZpY2VPbkVrc1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNre1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOkNvbnN0cnVjdCwgaWQ6c3RyaW5nLCBwcm9wcz86Y2RrLlN0YWNrUHJvcHMpIHtzdXBlcihzY29wZSxpZCxwcm9wcyk7XHJcblxyXG4gICAgICAgXHJcbiAgICBjb25zdCBlbnZjb25maWdzID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2VudmNvbmZpZ3MnKTtcclxuXHJcbiAgICBjb25zdCBpYW1yb2xlZm9yY2x1c3RlciA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnRWtzQWRtaW5Sb2xlJywge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQWNjb3VudFJvb3RQcmluY2lwYWwoKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHZwYyA9IG5ldyBlYzIuVnBjKHRoaXMsICdWcGMnLCB7XHJcbiAgICAgIG5hdEdhdGV3YXlzOiAxLFxyXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgbmFtZTogJ1ByaXZhdGVTdWJuZXQnLFxyXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcclxuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIG5hbWU6ICdQdWJsaWNTdWJuZXQnLFxyXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxyXG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjbHVzdGVyID0gbmV3IGVrcy5DbHVzdGVyKHRoaXMsICdFa3NDbHVzdGVyJywge1xyXG4gICAgICBjbHVzdGVyTmFtZTogJ0Vrc0NsdXN0ZXInLFxyXG4gICAgICBkZWZhdWx0Q2FwYWNpdHk6IDAsXHJcbiAgICAgIHZwYyxcclxuICAgICAgdmVyc2lvbjogZWtzLkt1YmVybmV0ZXNWZXJzaW9uLlYxXzI4LFxyXG4gICAgICBrdWJlY3RsTGF5ZXI6IG5ldyBLdWJlY3RsVjI4TGF5ZXIodGhpcywgJ2t1YmVjdGwnKSxcclxuICAgICAgdnBjU3VibmV0czogW3sgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9XSxcclxuICAgICAgbWFzdGVyc1JvbGU6IGlhbXJvbGVmb3JjbHVzdGVyLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgbm9kZWdyb3VwID0gY2x1c3Rlci5hZGROb2RlZ3JvdXBDYXBhY2l0eSgnTm9kZUdyb3VwJywge1xyXG4gICAgICBkZXNpcmVkU2l6ZTogMixcclxuICAgICAgaW5zdGFuY2VUeXBlczogW25ldyBlYzIuSW5zdGFuY2VUeXBlKCd0My5tZWRpdW0nKV0sXHJcbiAgICAgIHJlbW90ZUFjY2Vzczoge1xyXG4gICAgICAgIHNzaEtleU5hbWU6ICdkZW1vJyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIG5vZGVncm91cC5yb2xlLmFkZE1hbmFnZWRQb2xpY3koXHJcbiAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnQW1hem9uU1NNTWFuYWdlZEluc3RhbmNlQ29yZScpXHJcbiAgICApO1xyXG5cclxuICAgIGNsdXN0ZXIuYXdzQXV0aC5hZGRSb2xlTWFwcGluZyhub2RlZ3JvdXAucm9sZSwge1xyXG4gICAgICB1c2VybmFtZTogJ3N5c3RlbTpub2RlOnt7RUMyUHJpdmF0ZUROU05hbWV9fScsXHJcbiAgICAgIGdyb3VwczogWydzeXN0ZW06Ym9vdHN0cmFwcGVycycsICdzeXN0ZW06bm9kZXMnLCAnc3lzdGVtOm1hc3RlcnMnXSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNsdXN0ZXIuYWRkSGVsbUNoYXJ0KCdNZXRyaWNzU2VydmVyJywge1xyXG4gICAgICBjaGFydDogJ21ldHJpY3Mtc2VydmVyJyxcclxuICAgICAgcmVwb3NpdG9yeTogJ2h0dHBzOi8va3ViZXJuZXRlcy1zaWdzLmdpdGh1Yi5pby9tZXRyaWNzLXNlcnZlci8nLFxyXG4gICAgICByZWxlYXNlOiAnbWV0cmljcy1zZXJ2ZXInLFxyXG4gICAgICBuYW1lc3BhY2U6ICdrdWJlLXN5c3RlbScsXHJcbiAgICAgIHZhbHVlczoge1xyXG4gICAgICAgIGFyZ3M6IFtcclxuICAgICAgICAgICctLWt1YmVsZXQtaW5zZWN1cmUtdGxzJyxcclxuICAgICAgICAgICctLWt1YmVsZXQtcHJlZmVycmVkLWFkZHJlc3MtdHlwZXM9SW50ZXJuYWxJUCxIb3N0bmFtZSxFeHRlcm5hbElQJyxcclxuICAgICAgICBdLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgbmFtZXNwYWNlTWFuaWZlc3RQYXRoID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJ21hbmlmZXN0cycsICduYW1lc3BhY2UtY2xvdWR3YXRjaC55YW1sJyk7XHJcbiAgICBjb25zdCBuYW1lc3BhY2VNYW5pZmVzdENvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobmFtZXNwYWNlTWFuaWZlc3RQYXRoLCAndXRmOCcpO1xyXG4gICAgY29uc3QgbmFtZXNwYWNlRG9jcyA9IHlhbWwucGFyc2VBbGxEb2N1bWVudHMobmFtZXNwYWNlTWFuaWZlc3RDb250ZW50KTtcclxuICAgIGNvbnN0IG5hbWVzcGFjZVJlc291cmNlcyA9IG5hbWVzcGFjZURvY3MubWFwKChkb2MpID0+IGRvYy50b0pTT04oKSkuZmlsdGVyKEJvb2xlYW4pO1xyXG5cclxuICAgIGNvbnN0IGNsb3Vkd2F0Y2hOYW1lc3BhY2UgPSBjbHVzdGVyLmFkZE1hbmlmZXN0KCdDbG91ZFdhdGNoTmFtZXNwYWNlJywgLi4ubmFtZXNwYWNlUmVzb3VyY2VzKTtcclxuXHJcbiAgICBjb25zdCBjb25kaXRpb25Kc29uID0gbmV3IGNkay5DZm5Kc29uKHRoaXMsICdPSURDQ29uZGl0aW9uJywge1xyXG4gICAgICB2YWx1ZToge1xyXG4gICAgICAgIFtgJHtjbHVzdGVyLm9wZW5JZENvbm5lY3RQcm92aWRlci5vcGVuSWRDb25uZWN0UHJvdmlkZXJJc3N1ZXJ9OnN1YmBdOlxyXG4gICAgICAgICAgJ3N5c3RlbTpzZXJ2aWNlYWNjb3VudDphbWF6b24tY2xvdWR3YXRjaDpmbHVlbnQtYml0JyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGZsdWVudEJpdFNhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnRmx1ZW50Qml0SVJTQScsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLldlYklkZW50aXR5UHJpbmNpcGFsKFxyXG4gICAgICAgIGNsdXN0ZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyLm9wZW5JZENvbm5lY3RQcm92aWRlckFybixcclxuICAgICAgICB7XHJcbiAgICAgICAgICBTdHJpbmdFcXVhbHM6IGNvbmRpdGlvbkpzb24sXHJcbiAgICAgICAgfVxyXG4gICAgICApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgZmx1ZW50Qml0U2FSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcclxuICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXHJcbiAgICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnLFxyXG4gICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJyxcclxuICAgICAgICBdLFxyXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovZWtzLypgXSxcclxuICAgICAgfSlcclxuICAgICk7XHJcblxyXG4gICAgY29uc3QgdmFsdWVzWWFtbFBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnbWFuaWZlc3RzJywgJ3ZhbHVlcy55YW1sJyk7XHJcbiAgICBjb25zdCB2YWx1ZXNZYW1sQ29udGVudCA9IGZzLnJlYWRGaWxlU3luYyh2YWx1ZXNZYW1sUGF0aCwgJ3V0ZjgnKTtcclxuICAgIGNvbnN0IHZhbHVlcyA9IHlhbWwucGFyc2UodmFsdWVzWWFtbENvbnRlbnQpO1xyXG5cclxuICAgIGNvbnN0IG1hbmlmZXN0c0RpciA9ICdtYW5pZmVzdHMnO1xyXG4gICAgY29uc3QgZmlsZXMgPSBbXHJcbiAgICAgICduYW1lc3BhY2UueWFtbCcsXHJcbiAgICAgICdyb2xlYmluZGluZy55YW1sJyxcclxuICAgICAgJ2NvbmZpZ01hcC1zZWNyZXQueWFtbCcsXHJcbiAgICAgICdkZXBsb3ltZW50LnlhbWwnLFxyXG4gICAgICAnSFBBLnlhbWwnLFxyXG4gICAgICAnam9iLnlhbWwnLFxyXG4gICAgXTtcclxuXHJcbiAgICBsZXQgcHJldmlvdXNIZWxtQ2hhcnQ6IGVrcy5IZWxtQ2hhcnQgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XHJcblxyXG4gICAgZm9yIChjb25zdCBlbnZOYW1lIG9mIE9iamVjdC5rZXlzKGVudmNvbmZpZ3MpKSB7XHJcbiAgICAgIGNvbnN0IGNvbmZpZyA9IGVudmNvbmZpZ3NbZW52TmFtZV07XHJcblxyXG4gICAgICBjb25zdCBwbGFjZWhvbGRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XHJcbiAgICAgICAgJ3t7RU5WfX0nOiBlbnZOYW1lLFxyXG4gICAgICAgICd7e0FQUF9WRVJTSU9OfX0nOiBjb25maWcuYXBwVmVyc2lvbiB8fCAnMS4wLjAnLFxyXG4gICAgICAgICd7e1JFUExJQ0FfQ09VTlR9fSc6IChjb25maWcucmVwbGljYUNvdW50IHx8IDEpLnRvU3RyaW5nKCksXHJcbiAgICAgICAgJ3t7UkVRVUVTVF9DUFV9fSc6IGNvbmZpZy5yZXF1ZXN0Q3B1IHx8ICcxMDBtJyxcclxuICAgICAgICAne3tMSU1JVF9DUFV9fSc6IGNvbmZpZy5saW1pdENwdSB8fCAnMjAwbScsXHJcbiAgICAgICAgJ3t7RkVBVFVSRV9GTEFHfX0nOiBjb25maWcuZmVhdHVyZUZsYWcgPT09IHVuZGVmaW5lZCA/ICdmYWxzZScgOiBjb25maWcuZmVhdHVyZUZsYWcudG9TdHJpbmcoKSxcclxuICAgICAgICAne3tMT0dfR1JPVVBfTkFNRX19JzogYC9la3MvJHtlbnZOYW1lfS9hcHAtbG9nc2AsICAvLyBEeW5hbWljIGxvZyBncm91cCBuYW1lXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXBsYWNlUGxhY2Vob2xkZXJzID0gKGNvbnRlbnQ6IHN0cmluZykgPT4ge1xyXG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBsYWNlaG9sZGVycykpIHtcclxuICAgICAgICAgIGNvbnRlbnQgPSBjb250ZW50LnJlcGxhY2UobmV3IFJlZ0V4cChrZXksICdnJyksIHZhbHVlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCBhbGxSZXNvdXJjZXMgPSBmaWxlcy5mbGF0TWFwKChmaWxlKSA9PiB7XHJcbiAgICAgICAgY29uc3QgY29udGVudCA9IHJlcGxhY2VQbGFjZWhvbGRlcnMoXHJcbiAgICAgICAgICBmcy5yZWFkRmlsZVN5bmMocGF0aC5qb2luKG1hbmlmZXN0c0RpciwgZmlsZSksICd1dGY4JylcclxuICAgICAgICApO1xyXG4gICAgICAgIHJldHVybiB5YW1sLnBhcnNlQWxsRG9jdW1lbnRzKGNvbnRlbnQpLm1hcCgoZG9jKSA9PiBkb2MudG9KU09OKCkpLmZpbHRlcihCb29sZWFuKTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBuYW1lc3BhY2VSZXNvdXJjZXMgPSBhbGxSZXNvdXJjZXMuZmlsdGVyKChyZXMpID0+IHJlcy5raW5kID09PSAnTmFtZXNwYWNlJyk7XHJcbiAgICAgIGNvbnN0IG90aGVyUmVzb3VyY2VzID0gYWxsUmVzb3VyY2VzLmZpbHRlcigocmVzKSA9PiByZXMua2luZCAhPT0gJ05hbWVzcGFjZScpO1xyXG5cclxuICAgICAgY29uc3QgbmFtZXNwYWNlTWFuaWZlc3QgPSBjbHVzdGVyLmFkZE1hbmlmZXN0KGBOYW1lc3BhY2VNYW5pZmVzdC0ke2Vudk5hbWV9YCwgLi4ubmFtZXNwYWNlUmVzb3VyY2VzKTtcclxuICAgICAgY29uc3QgYXBwTWFuaWZlc3QgPSBjbHVzdGVyLmFkZE1hbmlmZXN0KGBBcHBNYW5pZmVzdHMtJHtlbnZOYW1lfWAsIC4uLm90aGVyUmVzb3VyY2VzKTtcclxuXHJcbiAgICAgIGFwcE1hbmlmZXN0Lm5vZGUuYWRkRGVwZW5kZW5jeShuYW1lc3BhY2VNYW5pZmVzdCk7XHJcblxyXG4gICAgICBjb25zdCBmbHVlbnRCaXQgPSBjbHVzdGVyLmFkZEhlbG1DaGFydChgRmx1ZW50Qml0LSR7ZW52TmFtZX1gLCB7XHJcbiAgICAgICAgY2hhcnQ6ICdhd3MtZm9yLWZsdWVudC1iaXQnLFxyXG4gICAgICAgIHJlcG9zaXRvcnk6ICdodHRwczovL2F3cy5naXRodWIuaW8vZWtzLWNoYXJ0cycsXHJcbiAgICAgICAgcmVsZWFzZTogYGZsdWVudC1iaXQtJHtlbnZOYW1lfWAsXHJcbiAgICAgICAgbmFtZXNwYWNlOiAnYW1hem9uLWNsb3Vkd2F0Y2gnLFxyXG4gICAgICAgIGNyZWF0ZU5hbWVzcGFjZTogZmFsc2UsICBcclxuICAgICAgICB2YWx1ZXM6IHtcclxuICAgICAgICAgIC4uLnZhbHVlcywgXHJcbiAgICAgICAgICBzZXJ2aWNlQWNjb3VudDoge1xyXG4gICAgICAgICAgICBuYW1lOiAnZmx1ZW50LWJpdCcsXHJcbiAgICAgICAgICAgIGFubm90YXRpb25zOiB7XHJcbiAgICAgICAgICAgICAgJ2Vrcy5hbWF6b25hd3MuY29tL3JvbGUtYXJuJzogZmx1ZW50Qml0U2FSb2xlLnJvbGVBcm4sXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgZmx1ZW50Qml0Lm5vZGUuYWRkRGVwZW5kZW5jeShjbG91ZHdhdGNoTmFtZXNwYWNlKTtcclxuICAgICAgaWYgKHByZXZpb3VzSGVsbUNoYXJ0KSB7XHJcbiAgICAgICAgZmx1ZW50Qml0Lm5vZGUuYWRkRGVwZW5kZW5jeShwcmV2aW91c0hlbG1DaGFydCk7XHJcbiAgICAgIH1cclxuICAgICAgcHJldmlvdXNIZWxtQ2hhcnQgPSBmbHVlbnRCaXQ7XHJcbiAgICB9XHJcbn19XHJcblxyXG4iXX0=