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
        const vpc = new ec2.Vpc(this, 'vpc', {
            natGateways: 1,
            subnetConfiguration: [
                { name: 'PrivateSubnet', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24, },
                { name: 'PublicSubnet', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24, },
            ],
        });
        const cluster = new eks.Cluster(this, 'EksCluster', { clusterName: 'EksCluster',
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
            remoteAccess: { sshKeyName: 'demo',
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
            values: { args: [
                    '--kubelet-insecure-tls',
                    '--kubelet-preferred-address-types=InternalIP,Hostname,ExternalIP',
                ], },
        });
        const namespaceManifestPath = path.join(__dirname, 'manifests', 'namespace-cloudwatch.yaml');
        const namespaceManifestContent = fs.readFileSync(namespaceManifestPath, 'utf8');
        const namespaceDocs = yaml.parseAllDocuments(namespaceManifestContent);
        const namespaceResources = namespaceDocs.map(doc => doc.toJSON()).filter(Boolean);
        const cloudwatchNamespace = cluster.addManifest('CloudWatchNamespace', ...namespaceResources);
        const fluentBitSaRole = new iam.Role(this, 'FluentBitIRSA', {
            assumedBy: new iam.WebIdentityPrincipal(cluster.openIdConnectProvider.openIdConnectProviderArn, {
                [`${cluster.openIdConnectProvider.openIdConnectProviderIssuer}:sub`]: 'system:serviceaccount:amazon-cloudwatch:fluent-bit',
            }),
        });
        fluentBitSaRole.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "logs:DescribeLogStreams",
            ],
            resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/eks/*`],
        }));
        const manifestsDir = 'manifests';
        const files = ['namespace.yaml', 'rolebinding.yaml', 'configMap-secret.yaml', 'deployment.yaml', 'HPA.yaml', 'job.yaml'];
        for (const envName of Object.keys(envconfigs)) {
            const config = envconfigs[envName];
            const placeholders = {
                '{{ENV}}': envName,
                '{{APP_VERSION}}': config.appVersion || '1.0.0',
                '{{REPLICA_COUNT}}': (config.replicaCount || 1).toString(),
                '{{REQUEST_CPU}}': config.requestCpu || '100m',
                '{{LIMIT_CPU}}': config.limitCpu || '200m',
                '{{FEATURE_FLAG}}': config.featureFlag === undefined ? 'false' : config.featureFlag.toString(),
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
                    serviceAccount: {
                        create: false,
                        name: 'fluent-bit',
                        annotations: {
                            'eks.amazonaws.com/role-arn': fluentBitSaRole.roleArn,
                        },
                    },
                    cloudWatch: {
                        enabled: true,
                        logGroupName: `/eks/${envName}/app-logs`,
                        region: this.region,
                        autoCreateGroup: true,
                    },
                    tolerations: [{
                            key: 'node-role.kubernetes.io/control-plane',
                            effect: 'NoSchedule',
                        }],
                },
            });
            fluentBit.node.addDependency(cloudwatchNamespace);
        }
    }
}
exports.DeployingMicoserviceOnEksStack = DeployingMicoserviceOnEksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLDZCQUE2QjtBQUM3QixnRkFBb0U7QUFDcEUsMkNBQTJDO0FBRTNDLE1BQWEsOEJBQStCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDM0QsWUFBWSxLQUFlLEVBQUUsRUFBUyxFQUFFLEtBQXFCO1FBQUcsS0FBSyxDQUFDLEtBQUssRUFBQyxFQUFFLEVBQUMsS0FBSyxDQUFDLENBQUM7UUFFcEYsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFekQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsb0JBQW9CLEVBQUU7U0FDMUMsQ0FBQyxDQUFDO1FBRUosTUFBTSxHQUFHLEdBQUMsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBQyxLQUFLLEVBQUM7WUFDOUIsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkIsRUFBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQixFQUFFLFFBQVEsRUFBRSxFQUFFLEdBQUU7Z0JBQ3RGLEVBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRSxVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLEVBQUUsR0FBRTthQUN6RTtTQUNGLENBQUMsQ0FBQztRQUVILE1BQU0sT0FBTyxHQUFDLElBQUks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OUMsT0FBTyxFQUFFLGNBQWMsT0FBTyxFQUFFO2dCQUNoQyxTQUFTLEVBQUUsbUJBQW1CO2dCQUM5QixlQUFlLEVBQUUsS0FBSztnQkFDdEIsTUFBTSxFQUFFO29CQUNOLGNBQWMsRUFBRTt3QkFDZCxNQUFNLEVBQUUsS0FBSzt3QkFDYixJQUFJLEVBQUUsWUFBWTt3QkFDbEIsV0FBVyxFQUFFOzRCQUNYLDRCQUE0QixFQUFFLGVBQWUsQ0FBQyxPQUFPO3lCQUN0RDtxQkFDRjtvQkFDRCxVQUFVLEVBQUU7d0JBQ1YsT0FBTyxFQUFFLElBQUk7d0JBQ2IsWUFBWSxFQUFFLFFBQVEsT0FBTyxXQUFXO3dCQUN4QyxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07d0JBQ25CLGVBQWUsRUFBRSxJQUFJO3FCQUN0QjtvQkFDRCxXQUFXLEVBQUUsQ0FBQzs0QkFDWixHQUFHLEVBQUUsdUNBQXVDOzRCQUM1QyxNQUFNLEVBQUUsWUFBWTt5QkFDckIsQ0FBQztpQkFDSDthQUNGLENBQUMsQ0FBQztZQUVILFNBQVMsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLG1CQUFtQixDQUFDLENBQUM7UUFDcEQsQ0FBQztJQUNILENBQUM7Q0FBQztBQS9JSix3RUErSUkiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgZWtzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1la3MnO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcclxuaW1wb3J0ICogYXMgeWFtbCBmcm9tICd5YW1sJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0IHsgS3ViZWN0bFYyOExheWVyIH0gZnJvbSAnQGF3cy1jZGsvbGFtYmRhLWxheWVyLWt1YmVjdGwtdjI4JztcclxuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xyXG5cclxuZXhwb3J0IGNsYXNzIERlcGxveWluZ01pY29zZXJ2aWNlT25Fa3NTdGFjayBleHRlbmRzIGNkay5TdGFja3tcclxuICBjb25zdHJ1Y3RvcihzY29wZTpDb25zdHJ1Y3QsIGlkOnN0cmluZywgcHJvcHM/OmNkay5TdGFja1Byb3BzKSB7c3VwZXIoc2NvcGUsaWQscHJvcHMpO1xyXG5cclxuICAgIGNvbnN0IGVudmNvbmZpZ3MgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnZW52Y29uZmlncycpO1xyXG5cclxuICAgIGNvbnN0IGlhbXJvbGVmb3JjbHVzdGVyID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdFa3NBZG1pblJvbGUnLCB7XHJcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5BY2NvdW50Um9vdFByaW5jaXBhbCgpLFxyXG4gICAgfSk7XHJcblxyXG4gICBjb25zdCB2cGM9bmV3IGVjMi5WcGModGhpcywndnBjJyx7XHJcbiAgICAgIG5hdEdhdGV3YXlzOiAxLFxyXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXHJcbiAgICAgICAge25hbWU6ICdQcml2YXRlU3VibmV0Jywgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUywgY2lkck1hc2s6IDI0LH0sXHJcbiAgICAgICAge25hbWU6ICdQdWJsaWNTdWJuZXQnLCBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsIGNpZHJNYXNrOiAyNCx9LFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgY2x1c3Rlcj1uZXcgZWtzLkNsdXN0ZXIodGhpcywgJ0Vrc0NsdXN0ZXInLCBcclxuICAgICAgICB7Y2x1c3Rlck5hbWU6ICdFa3NDbHVzdGVyJyxcclxuICAgICAgICAgIGRlZmF1bHRDYXBhY2l0eTowLFxyXG4gICAgICAgICAgdnBjLFxyXG4gICAgICAgICAgdmVyc2lvbjogZWtzLkt1YmVybmV0ZXNWZXJzaW9uLlYxXzI4LFxyXG4gICAgICAgICAga3ViZWN0bExheWVyOiBuZXcgS3ViZWN0bFYyOExheWVyKHRoaXMsICdrdWJlY3RsJyksXHJcbiAgICAgICAgICB2cGNTdWJuZXRzOlt7c3VibmV0VHlwZTplYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTfV0sXHJcbiAgICAgICAgICBtYXN0ZXJzUm9sZTppYW1yb2xlZm9yY2x1c3RlcixcclxuICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICBcclxuICAgICAgICBjb25zdCBub2RlZ3JvdXA9Y2x1c3Rlci5hZGROb2RlZ3JvdXBDYXBhY2l0eSgnTm9kZUdyb3VwJyx7XHJcbiAgICAgICAgZGVzaXJlZFNpemU6MixcclxuICAgICAgICBpbnN0YW5jZVR5cGVzOiBbbmV3IGVjMi5JbnN0YW5jZVR5cGUoJ3QzLm1lZGl1bScpXSxcclxuICAgICAgICByZW1vdGVBY2Nlc3M6IHsgc3NoS2V5TmFtZTogJ2RlbW8nLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgbm9kZWdyb3VwLnJvbGUuYWRkTWFuYWdlZFBvbGljeShpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWVcclxuICAgICAgICAoJ0FtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmUnKSk7XHJcbiAgICAgIFxyXG4gICAgICBjbHVzdGVyLmF3c0F1dGguYWRkUm9sZU1hcHBpbmcobm9kZWdyb3VwLnJvbGUsIHtcclxuICAgICAgICB1c2VybmFtZTogJ3N5c3RlbTpub2RlOnt7RUMyUHJpdmF0ZUROU05hbWV9fScsXHJcbiAgICAgICAgZ3JvdXBzOiBbJ3N5c3RlbTpib290c3RyYXBwZXJzJywgJ3N5c3RlbTpub2RlcycsICdzeXN0ZW06bWFzdGVycyddLFxyXG4gICAgIH0pO1xyXG5cclxuICAgICAgY2x1c3Rlci5hZGRIZWxtQ2hhcnQoJ01ldHJpY3NTZXJ2ZXInLCB7XHJcbiAgICAgICAgY2hhcnQ6ICdtZXRyaWNzLXNlcnZlcicsXHJcbiAgICAgICAgcmVwb3NpdG9yeTogJ2h0dHBzOi8va3ViZXJuZXRlcy1zaWdzLmdpdGh1Yi5pby9tZXRyaWNzLXNlcnZlci8nLFxyXG4gICAgICAgIHJlbGVhc2U6ICdtZXRyaWNzLXNlcnZlcicsXHJcbiAgICAgICAgbmFtZXNwYWNlOiAna3ViZS1zeXN0ZW0nLFxyXG4gICAgICAgIHZhbHVlczoge2FyZ3M6IFtcclxuICAgICAgICAnLS1rdWJlbGV0LWluc2VjdXJlLXRscycsXHJcbiAgICAgICAgJy0ta3ViZWxldC1wcmVmZXJyZWQtYWRkcmVzcy10eXBlcz1JbnRlcm5hbElQLEhvc3RuYW1lLEV4dGVybmFsSVAnLF0sfSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgY29uc3QgbmFtZXNwYWNlTWFuaWZlc3RQYXRoID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJ21hbmlmZXN0cycsICduYW1lc3BhY2UtY2xvdWR3YXRjaC55YW1sJyk7XHJcbiAgICBjb25zdCBuYW1lc3BhY2VNYW5pZmVzdENvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobmFtZXNwYWNlTWFuaWZlc3RQYXRoLCAndXRmOCcpO1xyXG4gICAgY29uc3QgbmFtZXNwYWNlRG9jcyA9IHlhbWwucGFyc2VBbGxEb2N1bWVudHMobmFtZXNwYWNlTWFuaWZlc3RDb250ZW50KTtcclxuICAgIGNvbnN0IG5hbWVzcGFjZVJlc291cmNlcyA9IG5hbWVzcGFjZURvY3MubWFwKGRvYyA9PiBkb2MudG9KU09OKCkpLmZpbHRlcihCb29sZWFuKTtcclxuICAgIGNvbnN0IGNsb3Vkd2F0Y2hOYW1lc3BhY2UgPSBjbHVzdGVyLmFkZE1hbmlmZXN0KCdDbG91ZFdhdGNoTmFtZXNwYWNlJywgLi4ubmFtZXNwYWNlUmVzb3VyY2VzKTtcclxuXHJcbiAgICBjb25zdCBmbHVlbnRCaXRTYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0ZsdWVudEJpdElSU0EnLCB7XHJcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5XZWJJZGVudGl0eVByaW5jaXBhbChcclxuICAgICAgICBjbHVzdGVyLm9wZW5JZENvbm5lY3RQcm92aWRlci5vcGVuSWRDb25uZWN0UHJvdmlkZXJBcm4sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgW2Ake2NsdXN0ZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyLm9wZW5JZENvbm5lY3RQcm92aWRlcklzc3Vlcn06c3ViYF06ICdzeXN0ZW06c2VydmljZWFjY291bnQ6YW1hem9uLWNsb3Vkd2F0Y2g6Zmx1ZW50LWJpdCcsXHJcbiAgICAgICAgfVxyXG4gICAgICApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgZmx1ZW50Qml0U2FSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgXCJsb2dzOkNyZWF0ZUxvZ0dyb3VwXCIsXHJcbiAgICAgICAgXCJsb2dzOkNyZWF0ZUxvZ1N0cmVhbVwiLFxyXG4gICAgICAgIFwibG9nczpQdXRMb2dFdmVudHNcIixcclxuICAgICAgICBcImxvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zXCIsXHJcbiAgICAgIF0sXHJcbiAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovZWtzLypgXSxcclxuICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IG1hbmlmZXN0c0Rpcj0nbWFuaWZlc3RzJztcclxuICAgICAgY29uc3QgZmlsZXMgPVsnbmFtZXNwYWNlLnlhbWwnLCdyb2xlYmluZGluZy55YW1sJywnY29uZmlnTWFwLXNlY3JldC55YW1sJywnZGVwbG95bWVudC55YW1sJywgJ0hQQS55YW1sJywgJ2pvYi55YW1sJ107XHJcblxyXG4gZm9yIChjb25zdCBlbnZOYW1lIG9mIE9iamVjdC5rZXlzKGVudmNvbmZpZ3MpKSB7XHJcbiAgICAgIGNvbnN0IGNvbmZpZyA9IGVudmNvbmZpZ3NbZW52TmFtZV07XHJcblxyXG4gICAgICBjb25zdCBwbGFjZWhvbGRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XHJcbiAgICAgICAgJ3t7RU5WfX0nOiBlbnZOYW1lLFxyXG4gICAgICAgICd7e0FQUF9WRVJTSU9OfX0nOiBjb25maWcuYXBwVmVyc2lvbiB8fCAnMS4wLjAnLFxyXG4gICAgICAgICd7e1JFUExJQ0FfQ09VTlR9fSc6IChjb25maWcucmVwbGljYUNvdW50IHx8IDEpLnRvU3RyaW5nKCksXHJcbiAgICAgICAgJ3t7UkVRVUVTVF9DUFV9fSc6IGNvbmZpZy5yZXF1ZXN0Q3B1IHx8ICcxMDBtJyxcclxuICAgICAgICAne3tMSU1JVF9DUFV9fSc6IGNvbmZpZy5saW1pdENwdSB8fCAnMjAwbScsXHJcbiAgICAgICAgJ3t7RkVBVFVSRV9GTEFHfX0nOiBjb25maWcuZmVhdHVyZUZsYWcgPT09IHVuZGVmaW5lZCA/ICdmYWxzZScgOiBjb25maWcuZmVhdHVyZUZsYWcudG9TdHJpbmcoKSxcclxuICAgICAgfTtcclxuICAgIFxyXG4gICAgICBjb25zdCByZXBsYWNlUGxhY2Vob2xkZXJzID0gKGNvbnRlbnQ6IHN0cmluZykgPT4ge1xyXG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBsYWNlaG9sZGVycykpIHtcclxuICAgICAgICAgIGNvbnRlbnQgPSBjb250ZW50LnJlcGxhY2UobmV3IFJlZ0V4cChrZXksICdnJyksIHZhbHVlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgICByZXR1cm4gY29udGVudDtcclxuICAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCBhbGxSZXNvdXJjZXMgPSBmaWxlcy5mbGF0TWFwKChmaWxlKSA9PiB7XHJcbiAgICAgICAgY29uc3QgY29udGVudCA9IHJlcGxhY2VQbGFjZWhvbGRlcnMoZnMucmVhZEZpbGVTeW5jKHBhdGguam9pbihtYW5pZmVzdHNEaXIsIGZpbGUpLCAndXRmOCcpXHJcbiAgICAgICAgKTtcclxuICAgICAgICByZXR1cm4geWFtbC5wYXJzZUFsbERvY3VtZW50cyhjb250ZW50KS5tYXAoKGRvYykgPT4gZG9jLnRvSlNPTigpKS5maWx0ZXIoQm9vbGVhbik7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgbmFtZXNwYWNlUmVzb3VyY2VzID0gYWxsUmVzb3VyY2VzLmZpbHRlcigocmVzKSA9PiByZXMua2luZCA9PT0gJ05hbWVzcGFjZScpO1xyXG4gICAgICBjb25zdCBvdGhlclJlc291cmNlcyA9IGFsbFJlc291cmNlcy5maWx0ZXIoKHJlcykgPT4gcmVzLmtpbmQgIT09ICdOYW1lc3BhY2UnKTtcclxuXHJcbiAgICAgIGNvbnN0IG5hbWVzcGFjZU1hbmlmZXN0ID0gY2x1c3Rlci5hZGRNYW5pZmVzdChgTmFtZXNwYWNlTWFuaWZlc3QtJHtlbnZOYW1lfWAsLi4ubmFtZXNwYWNlUmVzb3VyY2VzKTtcclxuICAgICAgY29uc3QgYXBwTWFuaWZlc3QgPSBjbHVzdGVyLmFkZE1hbmlmZXN0KGBBcHBNYW5pZmVzdHMtJHtlbnZOYW1lfWAsLi4ub3RoZXJSZXNvdXJjZXMpO1xyXG5cclxuICAgICAgYXBwTWFuaWZlc3Qubm9kZS5hZGREZXBlbmRlbmN5KG5hbWVzcGFjZU1hbmlmZXN0KTtcclxuXHJcbiAgICAgIGNvbnN0IGZsdWVudEJpdCA9IGNsdXN0ZXIuYWRkSGVsbUNoYXJ0KGBGbHVlbnRCaXQtJHtlbnZOYW1lfWAsIHtcclxuICAgICAgICBjaGFydDogJ2F3cy1mb3ItZmx1ZW50LWJpdCcsXHJcbiAgICAgICAgcmVwb3NpdG9yeTogJ2h0dHBzOi8vYXdzLmdpdGh1Yi5pby9la3MtY2hhcnRzJyxcclxuICAgICAgICByZWxlYXNlOiBgZmx1ZW50LWJpdC0ke2Vudk5hbWV9YCxcclxuICAgICAgICBuYW1lc3BhY2U6ICdhbWF6b24tY2xvdWR3YXRjaCcsXHJcbiAgICAgICAgY3JlYXRlTmFtZXNwYWNlOiBmYWxzZSxcclxuICAgICAgICB2YWx1ZXM6IHtcclxuICAgICAgICAgIHNlcnZpY2VBY2NvdW50OiB7XHJcbiAgICAgICAgICAgIGNyZWF0ZTogZmFsc2UsXHJcbiAgICAgICAgICAgIG5hbWU6ICdmbHVlbnQtYml0JyxcclxuICAgICAgICAgICAgYW5ub3RhdGlvbnM6IHtcclxuICAgICAgICAgICAgICAnZWtzLmFtYXpvbmF3cy5jb20vcm9sZS1hcm4nOiBmbHVlbnRCaXRTYVJvbGUucm9sZUFybixcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBjbG91ZFdhdGNoOiB7XHJcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgICAgIGxvZ0dyb3VwTmFtZTogYC9la3MvJHtlbnZOYW1lfS9hcHAtbG9nc2AsXHJcbiAgICAgICAgICAgIHJlZ2lvbjogdGhpcy5yZWdpb24sXHJcbiAgICAgICAgICAgIGF1dG9DcmVhdGVHcm91cDogdHJ1ZSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB0b2xlcmF0aW9uczogW3tcclxuICAgICAgICAgICAga2V5OiAnbm9kZS1yb2xlLmt1YmVybmV0ZXMuaW8vY29udHJvbC1wbGFuZScsXHJcbiAgICAgICAgICAgIGVmZmVjdDogJ05vU2NoZWR1bGUnLFxyXG4gICAgICAgICAgfV0sXHJcbiAgICAgICAgfSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBmbHVlbnRCaXQubm9kZS5hZGREZXBlbmRlbmN5KGNsb3Vkd2F0Y2hOYW1lc3BhY2UpO1xyXG4gICAgfVxyXG4gIH19XHJcblxyXG4iXX0=