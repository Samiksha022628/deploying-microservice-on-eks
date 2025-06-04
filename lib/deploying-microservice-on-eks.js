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
                { name: 'PrivateSubnet', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24, },
                { name: 'PublicSubnet', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24, },
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
        const cloudwatchNamespaceResources = namespaceDocs.map((doc) => doc.toJSON()).filter(Boolean);
        const cloudwatchNamespace = cluster.addManifest('CloudWatchNamespace', ...cloudwatchNamespaceResources);
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
        const fluentBit = cluster.addHelmChart(`FluentBit`, {
            chart: 'aws-for-fluent-bit',
            repository: 'https://aws.github.io/eks-charts',
            release: 'fluent-bit',
            namespace: 'amazon-cloudwatch',
            createNamespace: false,
            values: {
                ...values,
                serviceAccount: {
                    create: true,
                    name: 'fluent-bit',
                    annotations: {
                        'eks.amazonaws.com/role-arn': fluentBitSaRole.roleArn,
                    },
                },
            },
        });
        fluentBit.node.addDependency(cloudwatchNamespace);
        const manifestsDir = 'manifests';
        const files = [
            'namespace.yaml',
            'rolebinding.yaml',
            'configMap-secret.yaml',
            'deployment.yaml',
            'HPA.yaml',
            'job.yaml',
        ];
        for (const envName of Object.keys(envconfigs)) {
            const config = envconfigs[envName];
            const placeholders = {
                '{{ENV}}': envName,
                '{{APP_VERSION}}': config.appVersion || '1.0.0',
                '{{REPLICA_COUNT}}': (config.replicaCount || 1).toString(),
                '{{REQUEST_CPU}}': config.requestCpu || '100m',
                '{{LIMIT_CPU}}': config.limitCpu || '200m',
                '{{FEATURE_FLAG}}': config.featureFlag === undefined ? 'false' : config.featureFlag.toString(),
                '{{LOG_GROUP_NAME}}': `/eks/${envName}/app-logs`,
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
            const sortedResources = allResources.sort((a, b) => {
                if (a.kind === 'Namespace' && b.kind !== 'Namespace')
                    return -1;
                if (a.kind !== 'Namespace' && b.kind === 'Namespace')
                    return 1;
                return 0;
            });
            const manifest = cluster.addManifest(`AppManifests-${envName}`, ...sortedResources);
            manifest.node.addDependency(cloudwatchNamespace);
        }
    }
}
exports.DeployingMicoserviceOnEksStack = DeployingMicoserviceOnEksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLDZCQUE2QjtBQUM3QixnRkFBb0U7QUFDcEUsMkNBQTJDO0FBRTNDLE1BQWEsOEJBQStCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDM0QsWUFBWSxLQUFlLEVBQUUsRUFBUyxFQUFFLEtBQXFCO1FBQUcsS0FBSyxDQUFDLEtBQUssRUFBQyxFQUFFLEVBQUMsS0FBSyxDQUFDLENBQUM7UUFFcEYsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFekQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsb0JBQW9CLEVBQUU7U0FDMUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDbkMsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkIsRUFBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQixFQUFFLFFBQVEsRUFBRSxFQUFFLEdBQUU7Z0JBQ3RGLEVBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRSxVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLEVBQUUsR0FBRTthQUN6RTtTQUNGLENBQUMsQ0FBQztRQUVILE1BQU0sT0FBTyxHQUFHLElBQUks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Q0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsSUFBSSxDQUFDLEVBQUUsTUFBTSxDQUFDLENBQ3ZELENBQUM7Z0JBQ0YsT0FBTyxJQUFJLENBQUMsaUJBQWlCLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDcEYsQ0FBQyxDQUFDLENBQUM7WUFFSCxNQUFNLGVBQWUsR0FBRyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFO2dCQUNqRCxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssV0FBVyxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssV0FBVztvQkFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDO2dCQUNoRSxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssV0FBVyxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssV0FBVztvQkFBRSxPQUFPLENBQUMsQ0FBQztnQkFDL0QsT0FBTyxDQUFDLENBQUM7WUFDWCxDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxXQUFXLENBQUMsZ0JBQWdCLE9BQU8sRUFBRSxFQUFFLEdBQUcsZUFBZSxDQUFDLENBQUM7WUFFcEYsUUFBUSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsbUJBQW1CLENBQUMsQ0FBQztRQUNuRCxDQUFDO0lBQ0wsQ0FBQztDQUFDO0FBbktGLHdFQW1LRSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBla3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVrcyc7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xyXG5pbXBvcnQgKiBhcyB5YW1sIGZyb20gJ3lhbWwnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgeyBLdWJlY3RsVjI4TGF5ZXIgfSBmcm9tICdAYXdzLWNkay9sYW1iZGEtbGF5ZXIta3ViZWN0bC12MjgnO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcblxyXG5leHBvcnQgY2xhc3MgRGVwbG95aW5nTWljb3NlcnZpY2VPbkVrc1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNre1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOkNvbnN0cnVjdCwgaWQ6c3RyaW5nLCBwcm9wcz86Y2RrLlN0YWNrUHJvcHMpIHtzdXBlcihzY29wZSxpZCxwcm9wcyk7XHJcbiAgICAgXHJcbiAgICBjb25zdCBlbnZjb25maWdzID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2VudmNvbmZpZ3MnKTtcclxuXHJcbiAgICBjb25zdCBpYW1yb2xlZm9yY2x1c3RlciA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnRWtzQWRtaW5Sb2xlJywge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQWNjb3VudFJvb3RQcmluY2lwYWwoKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHZwYyA9IG5ldyBlYzIuVnBjKHRoaXMsICdWcGMnLCB7XHJcbiAgICAgIG5hdEdhdGV3YXlzOiAxLFxyXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXHJcbiAgICAgICAge25hbWU6ICdQcml2YXRlU3VibmV0Jywgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUywgY2lkck1hc2s6IDI0LH0sXHJcbiAgICAgICAge25hbWU6ICdQdWJsaWNTdWJuZXQnLCBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsIGNpZHJNYXNrOiAyNCx9LFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgY2x1c3RlciA9IG5ldyBla3MuQ2x1c3Rlcih0aGlzLCAnRWtzQ2x1c3RlcicsIHtcclxuICAgICAgY2x1c3Rlck5hbWU6ICdFa3NDbHVzdGVyJyxcclxuICAgICAgZGVmYXVsdENhcGFjaXR5OiAwLFxyXG4gICAgICB2cGMsXHJcbiAgICAgIHZlcnNpb246IGVrcy5LdWJlcm5ldGVzVmVyc2lvbi5WMV8yOCxcclxuICAgICAga3ViZWN0bExheWVyOiBuZXcgS3ViZWN0bFYyOExheWVyKHRoaXMsICdrdWJlY3RsJyksXHJcbiAgICAgIHZwY1N1Ym5ldHM6IFt7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfV0sXHJcbiAgICAgIG1hc3RlcnNSb2xlOiBpYW1yb2xlZm9yY2x1c3RlcixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IG5vZGVncm91cCA9IGNsdXN0ZXIuYWRkTm9kZWdyb3VwQ2FwYWNpdHkoJ05vZGVHcm91cCcsIHtcclxuICAgICAgZGVzaXJlZFNpemU6IDIsXHJcbiAgICAgIGluc3RhbmNlVHlwZXM6IFtuZXcgZWMyLkluc3RhbmNlVHlwZSgndDMubWVkaXVtJyldLFxyXG4gICAgICByZW1vdGVBY2Nlc3M6IHtcclxuICAgICAgICBzc2hLZXlOYW1lOiAnZGVtbycsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBub2RlZ3JvdXAucm9sZS5hZGRNYW5hZ2VkUG9saWN5KFxyXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmUnKVxyXG4gICAgKTtcclxuXHJcbiAgICBjbHVzdGVyLmF3c0F1dGguYWRkUm9sZU1hcHBpbmcobm9kZWdyb3VwLnJvbGUsIHtcclxuICAgICAgdXNlcm5hbWU6ICdzeXN0ZW06bm9kZTp7e0VDMlByaXZhdGVETlNOYW1lfX0nLFxyXG4gICAgICBncm91cHM6IFsnc3lzdGVtOmJvb3RzdHJhcHBlcnMnLCAnc3lzdGVtOm5vZGVzJywgJ3N5c3RlbTptYXN0ZXJzJ10sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjbHVzdGVyLmFkZEhlbG1DaGFydCgnTWV0cmljc1NlcnZlcicsIHtcclxuICAgICAgY2hhcnQ6ICdtZXRyaWNzLXNlcnZlcicsXHJcbiAgICAgIHJlcG9zaXRvcnk6ICdodHRwczovL2t1YmVybmV0ZXMtc2lncy5naXRodWIuaW8vbWV0cmljcy1zZXJ2ZXIvJyxcclxuICAgICAgcmVsZWFzZTogJ21ldHJpY3Mtc2VydmVyJyxcclxuICAgICAgbmFtZXNwYWNlOiAna3ViZS1zeXN0ZW0nLFxyXG4gICAgICB2YWx1ZXM6IHtcclxuICAgICAgICBhcmdzOiBbXHJcbiAgICAgICAgICAnLS1rdWJlbGV0LWluc2VjdXJlLXRscycsXHJcbiAgICAgICAgICAnLS1rdWJlbGV0LXByZWZlcnJlZC1hZGRyZXNzLXR5cGVzPUludGVybmFsSVAsSG9zdG5hbWUsRXh0ZXJuYWxJUCcsXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IG5hbWVzcGFjZU1hbmlmZXN0UGF0aCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICdtYW5pZmVzdHMnLCAnbmFtZXNwYWNlLWNsb3Vkd2F0Y2gueWFtbCcpO1xyXG4gICAgY29uc3QgbmFtZXNwYWNlTWFuaWZlc3RDb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5hbWVzcGFjZU1hbmlmZXN0UGF0aCwgJ3V0ZjgnKTtcclxuICAgIGNvbnN0IG5hbWVzcGFjZURvY3MgPSB5YW1sLnBhcnNlQWxsRG9jdW1lbnRzKG5hbWVzcGFjZU1hbmlmZXN0Q29udGVudCk7XHJcbiAgICBjb25zdCBjbG91ZHdhdGNoTmFtZXNwYWNlUmVzb3VyY2VzID0gbmFtZXNwYWNlRG9jcy5tYXAoKGRvYykgPT4gZG9jLnRvSlNPTigpKS5maWx0ZXIoQm9vbGVhbik7XHJcbiAgICBjb25zdCBjbG91ZHdhdGNoTmFtZXNwYWNlID0gY2x1c3Rlci5hZGRNYW5pZmVzdCgnQ2xvdWRXYXRjaE5hbWVzcGFjZScsIC4uLmNsb3Vkd2F0Y2hOYW1lc3BhY2VSZXNvdXJjZXMpO1xyXG4gICAgXHJcbiAgICBjb25zdCBjb25kaXRpb25Kc29uID0gbmV3IGNkay5DZm5Kc29uKHRoaXMsICdPSURDQ29uZGl0aW9uJywge1xyXG4gICAgICB2YWx1ZToge1xyXG4gICAgICAgIFtgJHtjbHVzdGVyLm9wZW5JZENvbm5lY3RQcm92aWRlci5vcGVuSWRDb25uZWN0UHJvdmlkZXJJc3N1ZXJ9OnN1YmBdOlxyXG4gICAgICAgICAgJ3N5c3RlbTpzZXJ2aWNlYWNjb3VudDphbWF6b24tY2xvdWR3YXRjaDpmbHVlbnQtYml0JyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGZsdWVudEJpdFNhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnRmx1ZW50Qml0SVJTQScsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLldlYklkZW50aXR5UHJpbmNpcGFsKFxyXG4gICAgICAgIGNsdXN0ZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyLm9wZW5JZENvbm5lY3RQcm92aWRlckFybixcclxuICAgICAgICB7XHJcbiAgICAgICAgICBTdHJpbmdFcXVhbHM6IGNvbmRpdGlvbkpzb24sXHJcbiAgICAgICAgfVxyXG4gICAgICApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgZmx1ZW50Qml0U2FSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcclxuICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXHJcbiAgICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnLFxyXG4gICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJyxcclxuICAgICAgICBdLFxyXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovZWtzLypgXSxcclxuICAgICAgfSlcclxuICAgICk7XHJcblxyXG4gICAgY29uc3QgdmFsdWVzWWFtbFBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnbWFuaWZlc3RzJywgJ3ZhbHVlcy55YW1sJyk7XHJcbiAgICBjb25zdCB2YWx1ZXNZYW1sQ29udGVudCA9IGZzLnJlYWRGaWxlU3luYyh2YWx1ZXNZYW1sUGF0aCwgJ3V0ZjgnKTtcclxuICAgIGNvbnN0IHZhbHVlcyA9IHlhbWwucGFyc2UodmFsdWVzWWFtbENvbnRlbnQpO1xyXG5cclxuICAgIGNvbnN0IGZsdWVudEJpdCA9IGNsdXN0ZXIuYWRkSGVsbUNoYXJ0KGBGbHVlbnRCaXRgLCB7XHJcbiAgICAgIGNoYXJ0OiAnYXdzLWZvci1mbHVlbnQtYml0JyxcclxuICAgICAgcmVwb3NpdG9yeTogJ2h0dHBzOi8vYXdzLmdpdGh1Yi5pby9la3MtY2hhcnRzJyxcclxuICAgICAgcmVsZWFzZTogJ2ZsdWVudC1iaXQnLFxyXG4gICAgICBuYW1lc3BhY2U6ICdhbWF6b24tY2xvdWR3YXRjaCcsXHJcbiAgICAgIGNyZWF0ZU5hbWVzcGFjZTogZmFsc2UsXHJcbiAgICAgIHZhbHVlczoge1xyXG4gICAgICAgIC4uLnZhbHVlcyxcclxuICAgICAgICBzZXJ2aWNlQWNjb3VudDoge1xyXG4gICAgICAgICAgY3JlYXRlOiB0cnVlLFxyXG4gICAgICAgICAgbmFtZTogJ2ZsdWVudC1iaXQnLFxyXG4gICAgICAgICAgYW5ub3RhdGlvbnM6IHtcclxuICAgICAgICAgICAgJ2Vrcy5hbWF6b25hd3MuY29tL3JvbGUtYXJuJzogZmx1ZW50Qml0U2FSb2xlLnJvbGVBcm4sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBmbHVlbnRCaXQubm9kZS5hZGREZXBlbmRlbmN5KGNsb3Vkd2F0Y2hOYW1lc3BhY2UpO1xyXG5cclxuICAgIGNvbnN0IG1hbmlmZXN0c0RpciA9ICdtYW5pZmVzdHMnO1xyXG4gICAgY29uc3QgZmlsZXMgPSBbXHJcbiAgICAgICduYW1lc3BhY2UueWFtbCcsXHJcbiAgICAgICdyb2xlYmluZGluZy55YW1sJyxcclxuICAgICAgJ2NvbmZpZ01hcC1zZWNyZXQueWFtbCcsXHJcbiAgICAgICdkZXBsb3ltZW50LnlhbWwnLFxyXG4gICAgICAnSFBBLnlhbWwnLFxyXG4gICAgICAnam9iLnlhbWwnLFxyXG4gICAgXTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGVudk5hbWUgb2YgT2JqZWN0LmtleXMoZW52Y29uZmlncykpIHtcclxuICAgICAgY29uc3QgY29uZmlnID0gZW52Y29uZmlnc1tlbnZOYW1lXTtcclxuXHJcbiAgICAgIGNvbnN0IHBsYWNlaG9sZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcclxuICAgICAgICAne3tFTlZ9fSc6IGVudk5hbWUsXHJcbiAgICAgICAgJ3t7QVBQX1ZFUlNJT059fSc6IGNvbmZpZy5hcHBWZXJzaW9uIHx8ICcxLjAuMCcsXHJcbiAgICAgICAgJ3t7UkVQTElDQV9DT1VOVH19JzogKGNvbmZpZy5yZXBsaWNhQ291bnQgfHwgMSkudG9TdHJpbmcoKSxcclxuICAgICAgICAne3tSRVFVRVNUX0NQVX19JzogY29uZmlnLnJlcXVlc3RDcHUgfHwgJzEwMG0nLFxyXG4gICAgICAgICd7e0xJTUlUX0NQVX19JzogY29uZmlnLmxpbWl0Q3B1IHx8ICcyMDBtJyxcclxuICAgICAgICAne3tGRUFUVVJFX0ZMQUd9fSc6IGNvbmZpZy5mZWF0dXJlRmxhZyA9PT0gdW5kZWZpbmVkID8gJ2ZhbHNlJyA6IGNvbmZpZy5mZWF0dXJlRmxhZy50b1N0cmluZygpLFxyXG4gICAgICAgICd7e0xPR19HUk9VUF9OQU1FfX0nOiBgL2Vrcy8ke2Vudk5hbWV9L2FwcC1sb2dzYCxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlcGxhY2VQbGFjZWhvbGRlcnMgPSAoY29udGVudDogc3RyaW5nKSA9PiB7XHJcbiAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocGxhY2Vob2xkZXJzKSkge1xyXG4gICAgICAgICAgY29udGVudCA9IGNvbnRlbnQucmVwbGFjZShuZXcgUmVnRXhwKGtleSwgJ2cnKSwgdmFsdWUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gY29udGVudDtcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IGFsbFJlc291cmNlcyA9IGZpbGVzLmZsYXRNYXAoKGZpbGUpID0+IHtcclxuICAgICAgICBjb25zdCBjb250ZW50ID0gcmVwbGFjZVBsYWNlaG9sZGVycyhcclxuICAgICAgICAgIGZzLnJlYWRGaWxlU3luYyhwYXRoLmpvaW4obWFuaWZlc3RzRGlyLCBmaWxlKSwgJ3V0ZjgnKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgcmV0dXJuIHlhbWwucGFyc2VBbGxEb2N1bWVudHMoY29udGVudCkubWFwKChkb2MpID0+IGRvYy50b0pTT04oKSkuZmlsdGVyKEJvb2xlYW4pO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHNvcnRlZFJlc291cmNlcyA9IGFsbFJlc291cmNlcy5zb3J0KChhLCBiKSA9PiB7XHJcbiAgICAgICAgaWYgKGEua2luZCA9PT0gJ05hbWVzcGFjZScgJiYgYi5raW5kICE9PSAnTmFtZXNwYWNlJykgcmV0dXJuIC0xO1xyXG4gICAgICAgIGlmIChhLmtpbmQgIT09ICdOYW1lc3BhY2UnICYmIGIua2luZCA9PT0gJ05hbWVzcGFjZScpIHJldHVybiAxO1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IG1hbmlmZXN0ID0gY2x1c3Rlci5hZGRNYW5pZmVzdChgQXBwTWFuaWZlc3RzLSR7ZW52TmFtZX1gLCAuLi5zb3J0ZWRSZXNvdXJjZXMpO1xyXG5cclxuICAgICAgbWFuaWZlc3Qubm9kZS5hZGREZXBlbmRlbmN5KGNsb3Vkd2F0Y2hOYW1lc3BhY2UpO1xyXG4gICAgfVxyXG59fVxyXG5cclxuIl19