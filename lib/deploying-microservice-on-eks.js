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
                        create: true,
                        name: 'fluent-bit-${envName}',
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLDZCQUE2QjtBQUM3QixnRkFBb0U7QUFDcEUsMkNBQTJDO0FBRTNDLE1BQWEsOEJBQStCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDM0QsWUFBWSxLQUFlLEVBQUUsRUFBUyxFQUFFLEtBQXFCO1FBQUcsS0FBSyxDQUFDLEtBQUssRUFBQyxFQUFFLEVBQUMsS0FBSyxDQUFDLENBQUM7UUFHcEYsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFekQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsb0JBQW9CLEVBQUU7U0FDMUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDbkMsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkI7b0JBQ0UsSUFBSSxFQUFFLGVBQWU7b0JBQ3JCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtvQkFDOUMsUUFBUSxFQUFFLEVBQUU7aUJBQ2I7Z0JBQ0Q7b0JBQ0UsSUFBSSxFQUFFLGNBQWM7b0JBQ3BCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07b0JBQ2pDLFFBQVEsRUFBRSxFQUFFO2lCQUNiO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCxNQUFNLE9BQU8s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TEYsd0VBaUxFIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIGVrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWtzJztcclxuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcbmltcG9ydCAqIGFzIHlhbWwgZnJvbSAneWFtbCc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcbmltcG9ydCB7IEt1YmVjdGxWMjhMYXllciB9IGZyb20gJ0Bhd3MtY2RrL2xhbWJkYS1sYXllci1rdWJlY3RsLXYyOCc7XHJcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcclxuXHJcbmV4cG9ydCBjbGFzcyBEZXBsb3lpbmdNaWNvc2VydmljZU9uRWtzU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2t7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6Q29uc3RydWN0LCBpZDpzdHJpbmcsIHByb3BzPzpjZGsuU3RhY2tQcm9wcykge3N1cGVyKHNjb3BlLGlkLHByb3BzKTtcclxuXHJcbiAgICAgICBcclxuICAgIGNvbnN0IGVudmNvbmZpZ3MgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnZW52Y29uZmlncycpO1xyXG5cclxuICAgIGNvbnN0IGlhbXJvbGVmb3JjbHVzdGVyID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdFa3NBZG1pblJvbGUnLCB7XHJcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5BY2NvdW50Um9vdFByaW5jaXBhbCgpLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgdnBjID0gbmV3IGVjMi5WcGModGhpcywgJ1ZwYycsIHtcclxuICAgICAgbmF0R2F0ZXdheXM6IDEsXHJcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBuYW1lOiAnUHJpdmF0ZVN1Ym5ldCcsXHJcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxyXG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgbmFtZTogJ1B1YmxpY1N1Ym5ldCcsXHJcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsXHJcbiAgICAgICAgICBjaWRyTWFzazogMjQsXHJcbiAgICAgICAgfSxcclxuICAgICAgXSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNsdXN0ZXIgPSBuZXcgZWtzLkNsdXN0ZXIodGhpcywgJ0Vrc0NsdXN0ZXInLCB7XHJcbiAgICAgIGNsdXN0ZXJOYW1lOiAnRWtzQ2x1c3RlcicsXHJcbiAgICAgIGRlZmF1bHRDYXBhY2l0eTogMCxcclxuICAgICAgdnBjLFxyXG4gICAgICB2ZXJzaW9uOiBla3MuS3ViZXJuZXRlc1ZlcnNpb24uVjFfMjgsXHJcbiAgICAgIGt1YmVjdGxMYXllcjogbmV3IEt1YmVjdGxWMjhMYXllcih0aGlzLCAna3ViZWN0bCcpLFxyXG4gICAgICB2cGNTdWJuZXRzOiBbeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH1dLFxyXG4gICAgICBtYXN0ZXJzUm9sZTogaWFtcm9sZWZvcmNsdXN0ZXIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBub2RlZ3JvdXAgPSBjbHVzdGVyLmFkZE5vZGVncm91cENhcGFjaXR5KCdOb2RlR3JvdXAnLCB7XHJcbiAgICAgIGRlc2lyZWRTaXplOiAyLFxyXG4gICAgICBpbnN0YW5jZVR5cGVzOiBbbmV3IGVjMi5JbnN0YW5jZVR5cGUoJ3QzLm1lZGl1bScpXSxcclxuICAgICAgcmVtb3RlQWNjZXNzOiB7XHJcbiAgICAgICAgc3NoS2V5TmFtZTogJ2RlbW8nLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgbm9kZWdyb3VwLnJvbGUuYWRkTWFuYWdlZFBvbGljeShcclxuICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBbWF6b25TU01NYW5hZ2VkSW5zdGFuY2VDb3JlJylcclxuICAgICk7XHJcblxyXG4gICAgY2x1c3Rlci5hd3NBdXRoLmFkZFJvbGVNYXBwaW5nKG5vZGVncm91cC5yb2xlLCB7XHJcbiAgICAgIHVzZXJuYW1lOiAnc3lzdGVtOm5vZGU6e3tFQzJQcml2YXRlRE5TTmFtZX19JyxcclxuICAgICAgZ3JvdXBzOiBbJ3N5c3RlbTpib290c3RyYXBwZXJzJywgJ3N5c3RlbTpub2RlcycsICdzeXN0ZW06bWFzdGVycyddLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY2x1c3Rlci5hZGRIZWxtQ2hhcnQoJ01ldHJpY3NTZXJ2ZXInLCB7XHJcbiAgICAgIGNoYXJ0OiAnbWV0cmljcy1zZXJ2ZXInLFxyXG4gICAgICByZXBvc2l0b3J5OiAnaHR0cHM6Ly9rdWJlcm5ldGVzLXNpZ3MuZ2l0aHViLmlvL21ldHJpY3Mtc2VydmVyLycsXHJcbiAgICAgIHJlbGVhc2U6ICdtZXRyaWNzLXNlcnZlcicsXHJcbiAgICAgIG5hbWVzcGFjZTogJ2t1YmUtc3lzdGVtJyxcclxuICAgICAgdmFsdWVzOiB7XHJcbiAgICAgICAgYXJnczogW1xyXG4gICAgICAgICAgJy0ta3ViZWxldC1pbnNlY3VyZS10bHMnLFxyXG4gICAgICAgICAgJy0ta3ViZWxldC1wcmVmZXJyZWQtYWRkcmVzcy10eXBlcz1JbnRlcm5hbElQLEhvc3RuYW1lLEV4dGVybmFsSVAnLFxyXG4gICAgICAgIF0sXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBuYW1lc3BhY2VNYW5pZmVzdFBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnbWFuaWZlc3RzJywgJ25hbWVzcGFjZS1jbG91ZHdhdGNoLnlhbWwnKTtcclxuICAgIGNvbnN0IG5hbWVzcGFjZU1hbmlmZXN0Q29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhuYW1lc3BhY2VNYW5pZmVzdFBhdGgsICd1dGY4Jyk7XHJcbiAgICBjb25zdCBuYW1lc3BhY2VEb2NzID0geWFtbC5wYXJzZUFsbERvY3VtZW50cyhuYW1lc3BhY2VNYW5pZmVzdENvbnRlbnQpO1xyXG4gICAgY29uc3QgbmFtZXNwYWNlUmVzb3VyY2VzID0gbmFtZXNwYWNlRG9jcy5tYXAoKGRvYykgPT4gZG9jLnRvSlNPTigpKS5maWx0ZXIoQm9vbGVhbik7XHJcblxyXG4gICAgY29uc3QgY2xvdWR3YXRjaE5hbWVzcGFjZSA9IGNsdXN0ZXIuYWRkTWFuaWZlc3QoJ0Nsb3VkV2F0Y2hOYW1lc3BhY2UnLCAuLi5uYW1lc3BhY2VSZXNvdXJjZXMpO1xyXG5cclxuICAgIGNvbnN0IGNvbmRpdGlvbkpzb24gPSBuZXcgY2RrLkNmbkpzb24odGhpcywgJ09JRENDb25kaXRpb24nLCB7XHJcbiAgICAgIHZhbHVlOiB7XHJcbiAgICAgICAgW2Ake2NsdXN0ZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyLm9wZW5JZENvbm5lY3RQcm92aWRlcklzc3Vlcn06c3ViYF06XHJcbiAgICAgICAgICAnc3lzdGVtOnNlcnZpY2VhY2NvdW50OmFtYXpvbi1jbG91ZHdhdGNoOmZsdWVudC1iaXQnLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgZmx1ZW50Qml0U2FSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdGbHVlbnRCaXRJUlNBJywge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uV2ViSWRlbnRpdHlQcmluY2lwYWwoXHJcbiAgICAgICAgY2x1c3Rlci5vcGVuSWRDb25uZWN0UHJvdmlkZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyQXJuLFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFN0cmluZ0VxdWFsczogY29uZGl0aW9uSnNvbixcclxuICAgICAgICB9XHJcbiAgICAgICksXHJcbiAgICB9KTtcclxuXHJcbiAgICBmbHVlbnRCaXRTYVJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLFxyXG4gICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJyxcclxuICAgICAgICAgICdsb2dzOlB1dExvZ0V2ZW50cycsXHJcbiAgICAgICAgICAnbG9nczpEZXNjcmliZUxvZ1N0cmVhbXMnLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9la3MvKmBdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuXHJcbiAgICBjb25zdCB2YWx1ZXNZYW1sUGF0aCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICdtYW5pZmVzdHMnLCAndmFsdWVzLnlhbWwnKTtcclxuICAgIGNvbnN0IHZhbHVlc1lhbWxDb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKHZhbHVlc1lhbWxQYXRoLCAndXRmOCcpO1xyXG4gICAgY29uc3QgdmFsdWVzID0geWFtbC5wYXJzZSh2YWx1ZXNZYW1sQ29udGVudCk7XHJcblxyXG4gICAgY29uc3QgbWFuaWZlc3RzRGlyID0gJ21hbmlmZXN0cyc7XHJcbiAgICBjb25zdCBmaWxlcyA9IFtcclxuICAgICAgJ25hbWVzcGFjZS55YW1sJyxcclxuICAgICAgJ3JvbGViaW5kaW5nLnlhbWwnLFxyXG4gICAgICAnY29uZmlnTWFwLXNlY3JldC55YW1sJyxcclxuICAgICAgJ2RlcGxveW1lbnQueWFtbCcsXHJcbiAgICAgICdIUEEueWFtbCcsXHJcbiAgICAgICdqb2IueWFtbCcsXHJcbiAgICBdO1xyXG5cclxuICAgIGxldCBwcmV2aW91c0hlbG1DaGFydDogZWtzLkhlbG1DaGFydCB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGVudk5hbWUgb2YgT2JqZWN0LmtleXMoZW52Y29uZmlncykpIHtcclxuICAgICAgY29uc3QgY29uZmlnID0gZW52Y29uZmlnc1tlbnZOYW1lXTtcclxuXHJcbiAgICAgIGNvbnN0IHBsYWNlaG9sZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcclxuICAgICAgICAne3tFTlZ9fSc6IGVudk5hbWUsXHJcbiAgICAgICAgJ3t7QVBQX1ZFUlNJT059fSc6IGNvbmZpZy5hcHBWZXJzaW9uIHx8ICcxLjAuMCcsXHJcbiAgICAgICAgJ3t7UkVQTElDQV9DT1VOVH19JzogKGNvbmZpZy5yZXBsaWNhQ291bnQgfHwgMSkudG9TdHJpbmcoKSxcclxuICAgICAgICAne3tSRVFVRVNUX0NQVX19JzogY29uZmlnLnJlcXVlc3RDcHUgfHwgJzEwMG0nLFxyXG4gICAgICAgICd7e0xJTUlUX0NQVX19JzogY29uZmlnLmxpbWl0Q3B1IHx8ICcyMDBtJyxcclxuICAgICAgICAne3tGRUFUVVJFX0ZMQUd9fSc6IGNvbmZpZy5mZWF0dXJlRmxhZyA9PT0gdW5kZWZpbmVkID8gJ2ZhbHNlJyA6IGNvbmZpZy5mZWF0dXJlRmxhZy50b1N0cmluZygpLFxyXG4gICAgICAgICd7e0xPR19HUk9VUF9OQU1FfX0nOiBgL2Vrcy8ke2Vudk5hbWV9L2FwcC1sb2dzYCwgIC8vIER5bmFtaWMgbG9nIGdyb3VwIG5hbWVcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlcGxhY2VQbGFjZWhvbGRlcnMgPSAoY29udGVudDogc3RyaW5nKSA9PiB7XHJcbiAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocGxhY2Vob2xkZXJzKSkge1xyXG4gICAgICAgICAgY29udGVudCA9IGNvbnRlbnQucmVwbGFjZShuZXcgUmVnRXhwKGtleSwgJ2cnKSwgdmFsdWUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gY29udGVudDtcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IGFsbFJlc291cmNlcyA9IGZpbGVzLmZsYXRNYXAoKGZpbGUpID0+IHtcclxuICAgICAgICBjb25zdCBjb250ZW50ID0gcmVwbGFjZVBsYWNlaG9sZGVycyhcclxuICAgICAgICAgIGZzLnJlYWRGaWxlU3luYyhwYXRoLmpvaW4obWFuaWZlc3RzRGlyLCBmaWxlKSwgJ3V0ZjgnKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgcmV0dXJuIHlhbWwucGFyc2VBbGxEb2N1bWVudHMoY29udGVudCkubWFwKChkb2MpID0+IGRvYy50b0pTT04oKSkuZmlsdGVyKEJvb2xlYW4pO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IG5hbWVzcGFjZVJlc291cmNlcyA9IGFsbFJlc291cmNlcy5maWx0ZXIoKHJlcykgPT4gcmVzLmtpbmQgPT09ICdOYW1lc3BhY2UnKTtcclxuICAgICAgY29uc3Qgb3RoZXJSZXNvdXJjZXMgPSBhbGxSZXNvdXJjZXMuZmlsdGVyKChyZXMpID0+IHJlcy5raW5kICE9PSAnTmFtZXNwYWNlJyk7XHJcblxyXG4gICAgICBjb25zdCBuYW1lc3BhY2VNYW5pZmVzdCA9IGNsdXN0ZXIuYWRkTWFuaWZlc3QoYE5hbWVzcGFjZU1hbmlmZXN0LSR7ZW52TmFtZX1gLCAuLi5uYW1lc3BhY2VSZXNvdXJjZXMpO1xyXG4gICAgICBjb25zdCBhcHBNYW5pZmVzdCA9IGNsdXN0ZXIuYWRkTWFuaWZlc3QoYEFwcE1hbmlmZXN0cy0ke2Vudk5hbWV9YCwgLi4ub3RoZXJSZXNvdXJjZXMpO1xyXG5cclxuICAgICAgYXBwTWFuaWZlc3Qubm9kZS5hZGREZXBlbmRlbmN5KG5hbWVzcGFjZU1hbmlmZXN0KTtcclxuXHJcbiAgICAgIGNvbnN0IGZsdWVudEJpdCA9IGNsdXN0ZXIuYWRkSGVsbUNoYXJ0KGBGbHVlbnRCaXQtJHtlbnZOYW1lfWAsIHtcclxuICAgICAgICBjaGFydDogJ2F3cy1mb3ItZmx1ZW50LWJpdCcsXHJcbiAgICAgICAgcmVwb3NpdG9yeTogJ2h0dHBzOi8vYXdzLmdpdGh1Yi5pby9la3MtY2hhcnRzJyxcclxuICAgICAgICByZWxlYXNlOiBgZmx1ZW50LWJpdC0ke2Vudk5hbWV9YCxcclxuICAgICAgICBuYW1lc3BhY2U6ICdhbWF6b24tY2xvdWR3YXRjaCcsXHJcbiAgICAgICAgY3JlYXRlTmFtZXNwYWNlOiBmYWxzZSwgIFxyXG4gICAgICAgIHZhbHVlczoge1xyXG4gICAgICAgICAgLi4udmFsdWVzLCBcclxuICAgICAgICAgIHNlcnZpY2VBY2NvdW50OiB7XHJcbiAgICAgICAgICAgIGNyZWF0ZTogdHJ1ZSxcclxuICAgICAgICAgICAgbmFtZTogJ2ZsdWVudC1iaXQtJHtlbnZOYW1lfScsXHJcbiAgICAgICAgICAgIGFubm90YXRpb25zOiB7XHJcbiAgICAgICAgICAgICAgJ2Vrcy5hbWF6b25hd3MuY29tL3JvbGUtYXJuJzogZmx1ZW50Qml0U2FSb2xlLnJvbGVBcm4sXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgZmx1ZW50Qml0Lm5vZGUuYWRkRGVwZW5kZW5jeShjbG91ZHdhdGNoTmFtZXNwYWNlKTtcclxuICAgICAgaWYgKHByZXZpb3VzSGVsbUNoYXJ0KSB7XHJcbiAgICAgICAgZmx1ZW50Qml0Lm5vZGUuYWRkRGVwZW5kZW5jeShwcmV2aW91c0hlbG1DaGFydCk7XHJcbiAgICAgIH1cclxuICAgICAgcHJldmlvdXNIZWxtQ2hhcnQgPSBmbHVlbnRCaXQ7XHJcbiAgICB9XHJcbn19XHJcblxyXG4iXX0=