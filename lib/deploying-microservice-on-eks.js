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
                    ...values, // Inject parsed values.yaml content
                    serviceAccount: {
                        name: 'fluent-bit',
                        annotations: {
                            'eks.amazonaws.com/role-arn': fluentBitSaRole.roleArn,
                        },
                    },
                },
            });
            fluentBit.node.addDependency(namespaceManifest);
            if (previousHelmChart) {
                fluentBit.node.addDependency(previousHelmChart);
            }
            previousHelmChart = fluentBit;
        }
    }
}
exports.DeployingMicoserviceOnEksStack = DeployingMicoserviceOnEksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLDZCQUE2QjtBQUM3QixnRkFBb0U7QUFDcEUsMkNBQTJDO0FBRTNDLE1BQWEsOEJBQStCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDM0QsWUFBWSxLQUFlLEVBQUUsRUFBUyxFQUFFLEtBQXFCO1FBQUcsS0FBSyxDQUFDLEtBQUssRUFBQyxFQUFFLEVBQUMsS0FBSyxDQUFDLENBQUM7UUFHcEYsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFekQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsb0JBQW9CLEVBQUU7U0FDMUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDbkMsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkI7b0JBQ0UsSUFBSSxFQUFFLGVBQWU7b0JBQ3JCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtvQkFDOUMsUUFBUSxFQUFFLEVBQUU7aUJBQ2I7Z0JBQ0Q7b0JBQ0UsSUFBSSxFQUFFLGNBQWM7b0JBQ3BCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07b0JBQ2pDLFFBQVEsRUFBRSxFQUFFO2lCQUNiO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCxNQUFNLE9BQU8s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Z0JBQzNCLFVBQVUsRUFBRSxrQ0FBa0M7Z0JBQzlDLE9BQU8sRUFBRSxjQUFjLE9BQU8sRUFBRTtnQkFDaEMsU0FBUyxFQUFFLG1CQUFtQjtnQkFDOUIsZUFBZSxFQUFFLEtBQUs7Z0JBQ3RCLE1BQU0sRUFBRTtvQkFDTixHQUFHLE1BQU0sRUFBRSxvQ0FBb0M7b0JBQy9DLGNBQWMsRUFBRTt3QkFDZCxJQUFJLEVBQUUsWUFBWTt3QkFDbEIsV0FBVyxFQUFFOzRCQUNYLDRCQUE0QixFQUFFLGVBQWUsQ0FBQyxPQUFPO3lCQUN0RDtxQkFDRjtpQkFDRjthQUNGLENBQUMsQ0FBQztZQUVILFNBQVMsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGlCQUFpQixDQUFDLENBQUM7WUFDaEQsSUFBSSxpQkFBaUIsRUFBRSxDQUFDO2dCQUN0QixTQUFTLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1lBQ2xELENBQUM7WUFDRCxpQkFBaUIsR0FBRyxTQUFTLENBQUM7UUFDaEMsQ0FBQztJQUNMLENBQUM7Q0FBQztBQXpLRix3RUF5S0UiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgZWtzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1la3MnO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcclxuaW1wb3J0ICogYXMgeWFtbCBmcm9tICd5YW1sJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0IHsgS3ViZWN0bFYyOExheWVyIH0gZnJvbSAnQGF3cy1jZGsvbGFtYmRhLWxheWVyLWt1YmVjdGwtdjI4JztcclxuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xyXG5cclxuZXhwb3J0IGNsYXNzIERlcGxveWluZ01pY29zZXJ2aWNlT25Fa3NTdGFjayBleHRlbmRzIGNkay5TdGFja3tcclxuICBjb25zdHJ1Y3RvcihzY29wZTpDb25zdHJ1Y3QsIGlkOnN0cmluZywgcHJvcHM/OmNkay5TdGFja1Byb3BzKSB7c3VwZXIoc2NvcGUsaWQscHJvcHMpO1xyXG5cclxuICAgICAgIFxyXG4gICAgY29uc3QgZW52Y29uZmlncyA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdlbnZjb25maWdzJyk7XHJcblxyXG4gICAgY29uc3QgaWFtcm9sZWZvcmNsdXN0ZXIgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0Vrc0FkbWluUm9sZScsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB2cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCAnVnBjJywge1xyXG4gICAgICBuYXRHYXRld2F5czogMSxcclxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIG5hbWU6ICdQcml2YXRlU3VibmV0JyxcclxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXHJcbiAgICAgICAgICBjaWRyTWFzazogMjQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICBuYW1lOiAnUHVibGljU3VibmV0JyxcclxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcclxuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcclxuICAgICAgICB9LFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgY2x1c3RlciA9IG5ldyBla3MuQ2x1c3Rlcih0aGlzLCAnRWtzQ2x1c3RlcicsIHtcclxuICAgICAgY2x1c3Rlck5hbWU6ICdFa3NDbHVzdGVyJyxcclxuICAgICAgZGVmYXVsdENhcGFjaXR5OiAwLFxyXG4gICAgICB2cGMsXHJcbiAgICAgIHZlcnNpb246IGVrcy5LdWJlcm5ldGVzVmVyc2lvbi5WMV8yOCxcclxuICAgICAga3ViZWN0bExheWVyOiBuZXcgS3ViZWN0bFYyOExheWVyKHRoaXMsICdrdWJlY3RsJyksXHJcbiAgICAgIHZwY1N1Ym5ldHM6IFt7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfV0sXHJcbiAgICAgIG1hc3RlcnNSb2xlOiBpYW1yb2xlZm9yY2x1c3RlcixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IG5vZGVncm91cCA9IGNsdXN0ZXIuYWRkTm9kZWdyb3VwQ2FwYWNpdHkoJ05vZGVHcm91cCcsIHtcclxuICAgICAgZGVzaXJlZFNpemU6IDIsXHJcbiAgICAgIGluc3RhbmNlVHlwZXM6IFtuZXcgZWMyLkluc3RhbmNlVHlwZSgndDMubWVkaXVtJyldLFxyXG4gICAgICByZW1vdGVBY2Nlc3M6IHtcclxuICAgICAgICBzc2hLZXlOYW1lOiAnZGVtbycsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBub2RlZ3JvdXAucm9sZS5hZGRNYW5hZ2VkUG9saWN5KFxyXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmUnKVxyXG4gICAgKTtcclxuXHJcbiAgICBjbHVzdGVyLmF3c0F1dGguYWRkUm9sZU1hcHBpbmcobm9kZWdyb3VwLnJvbGUsIHtcclxuICAgICAgdXNlcm5hbWU6ICdzeXN0ZW06bm9kZTp7e0VDMlByaXZhdGVETlNOYW1lfX0nLFxyXG4gICAgICBncm91cHM6IFsnc3lzdGVtOmJvb3RzdHJhcHBlcnMnLCAnc3lzdGVtOm5vZGVzJywgJ3N5c3RlbTptYXN0ZXJzJ10sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjbHVzdGVyLmFkZEhlbG1DaGFydCgnTWV0cmljc1NlcnZlcicsIHtcclxuICAgICAgY2hhcnQ6ICdtZXRyaWNzLXNlcnZlcicsXHJcbiAgICAgIHJlcG9zaXRvcnk6ICdodHRwczovL2t1YmVybmV0ZXMtc2lncy5naXRodWIuaW8vbWV0cmljcy1zZXJ2ZXIvJyxcclxuICAgICAgcmVsZWFzZTogJ21ldHJpY3Mtc2VydmVyJyxcclxuICAgICAgbmFtZXNwYWNlOiAna3ViZS1zeXN0ZW0nLFxyXG4gICAgICB2YWx1ZXM6IHtcclxuICAgICAgICBhcmdzOiBbXHJcbiAgICAgICAgICAnLS1rdWJlbGV0LWluc2VjdXJlLXRscycsXHJcbiAgICAgICAgICAnLS1rdWJlbGV0LXByZWZlcnJlZC1hZGRyZXNzLXR5cGVzPUludGVybmFsSVAsSG9zdG5hbWUsRXh0ZXJuYWxJUCcsXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNvbmRpdGlvbkpzb24gPSBuZXcgY2RrLkNmbkpzb24odGhpcywgJ09JRENDb25kaXRpb24nLCB7XHJcbiAgICAgIHZhbHVlOiB7XHJcbiAgICAgICAgW2Ake2NsdXN0ZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyLm9wZW5JZENvbm5lY3RQcm92aWRlcklzc3Vlcn06c3ViYF06XHJcbiAgICAgICAgICAnc3lzdGVtOnNlcnZpY2VhY2NvdW50OmFtYXpvbi1jbG91ZHdhdGNoOmZsdWVudC1iaXQnLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgZmx1ZW50Qml0U2FSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdGbHVlbnRCaXRJUlNBJywge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uV2ViSWRlbnRpdHlQcmluY2lwYWwoXHJcbiAgICAgICAgY2x1c3Rlci5vcGVuSWRDb25uZWN0UHJvdmlkZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyQXJuLFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFN0cmluZ0VxdWFsczogY29uZGl0aW9uSnNvbixcclxuICAgICAgICB9XHJcbiAgICAgICksXHJcbiAgICB9KTtcclxuXHJcbiAgICBmbHVlbnRCaXRTYVJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLFxyXG4gICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJyxcclxuICAgICAgICAgICdsb2dzOlB1dExvZ0V2ZW50cycsXHJcbiAgICAgICAgICAnbG9nczpEZXNjcmliZUxvZ1N0cmVhbXMnLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9la3MvKmBdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuXHJcbiAgICBjb25zdCB2YWx1ZXNZYW1sUGF0aCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICdtYW5pZmVzdHMnLCAndmFsdWVzLnlhbWwnKTtcclxuICAgIGNvbnN0IHZhbHVlc1lhbWxDb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKHZhbHVlc1lhbWxQYXRoLCAndXRmOCcpO1xyXG4gICAgY29uc3QgdmFsdWVzID0geWFtbC5wYXJzZSh2YWx1ZXNZYW1sQ29udGVudCk7XHJcblxyXG4gICAgY29uc3QgbWFuaWZlc3RzRGlyID0gJ21hbmlmZXN0cyc7XHJcbiAgICBjb25zdCBmaWxlcyA9IFtcclxuICAgICAgJ25hbWVzcGFjZS55YW1sJyxcclxuICAgICAgJ3JvbGViaW5kaW5nLnlhbWwnLFxyXG4gICAgICAnY29uZmlnTWFwLXNlY3JldC55YW1sJyxcclxuICAgICAgJ2RlcGxveW1lbnQueWFtbCcsXHJcbiAgICAgICdIUEEueWFtbCcsXHJcbiAgICAgICdqb2IueWFtbCcsXHJcbiAgICBdO1xyXG5cclxuICAgIGxldCBwcmV2aW91c0hlbG1DaGFydDogZWtzLkhlbG1DaGFydCB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGVudk5hbWUgb2YgT2JqZWN0LmtleXMoZW52Y29uZmlncykpIHtcclxuICAgICAgY29uc3QgY29uZmlnID0gZW52Y29uZmlnc1tlbnZOYW1lXTtcclxuXHJcbiAgICAgIGNvbnN0IHBsYWNlaG9sZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcclxuICAgICAgICAne3tFTlZ9fSc6IGVudk5hbWUsXHJcbiAgICAgICAgJ3t7QVBQX1ZFUlNJT059fSc6IGNvbmZpZy5hcHBWZXJzaW9uIHx8ICcxLjAuMCcsXHJcbiAgICAgICAgJ3t7UkVQTElDQV9DT1VOVH19JzogKGNvbmZpZy5yZXBsaWNhQ291bnQgfHwgMSkudG9TdHJpbmcoKSxcclxuICAgICAgICAne3tSRVFVRVNUX0NQVX19JzogY29uZmlnLnJlcXVlc3RDcHUgfHwgJzEwMG0nLFxyXG4gICAgICAgICd7e0xJTUlUX0NQVX19JzogY29uZmlnLmxpbWl0Q3B1IHx8ICcyMDBtJyxcclxuICAgICAgICAne3tGRUFUVVJFX0ZMQUd9fSc6IGNvbmZpZy5mZWF0dXJlRmxhZyA9PT0gdW5kZWZpbmVkID8gJ2ZhbHNlJyA6IGNvbmZpZy5mZWF0dXJlRmxhZy50b1N0cmluZygpLFxyXG4gICAgICAgICd7e0xPR19HUk9VUF9OQU1FfX0nOiBgL2Vrcy8ke2Vudk5hbWV9L2FwcC1sb2dzYCwgIC8vIER5bmFtaWMgbG9nIGdyb3VwIG5hbWVcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlcGxhY2VQbGFjZWhvbGRlcnMgPSAoY29udGVudDogc3RyaW5nKSA9PiB7XHJcbiAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocGxhY2Vob2xkZXJzKSkge1xyXG4gICAgICAgICAgY29udGVudCA9IGNvbnRlbnQucmVwbGFjZShuZXcgUmVnRXhwKGtleSwgJ2cnKSwgdmFsdWUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gY29udGVudDtcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IGFsbFJlc291cmNlcyA9IGZpbGVzLmZsYXRNYXAoKGZpbGUpID0+IHtcclxuICAgICAgICBjb25zdCBjb250ZW50ID0gcmVwbGFjZVBsYWNlaG9sZGVycyhcclxuICAgICAgICAgIGZzLnJlYWRGaWxlU3luYyhwYXRoLmpvaW4obWFuaWZlc3RzRGlyLCBmaWxlKSwgJ3V0ZjgnKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgcmV0dXJuIHlhbWwucGFyc2VBbGxEb2N1bWVudHMoY29udGVudCkubWFwKChkb2MpID0+IGRvYy50b0pTT04oKSkuZmlsdGVyKEJvb2xlYW4pO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IG5hbWVzcGFjZVJlc291cmNlcyA9IGFsbFJlc291cmNlcy5maWx0ZXIoKHJlcykgPT4gcmVzLmtpbmQgPT09ICdOYW1lc3BhY2UnKTtcclxuICAgICAgY29uc3Qgb3RoZXJSZXNvdXJjZXMgPSBhbGxSZXNvdXJjZXMuZmlsdGVyKChyZXMpID0+IHJlcy5raW5kICE9PSAnTmFtZXNwYWNlJyk7XHJcblxyXG4gICAgICBjb25zdCBuYW1lc3BhY2VNYW5pZmVzdCA9IGNsdXN0ZXIuYWRkTWFuaWZlc3QoYE5hbWVzcGFjZU1hbmlmZXN0LSR7ZW52TmFtZX1gLCAuLi5uYW1lc3BhY2VSZXNvdXJjZXMpO1xyXG4gICAgICBjb25zdCBhcHBNYW5pZmVzdCA9IGNsdXN0ZXIuYWRkTWFuaWZlc3QoYEFwcE1hbmlmZXN0cy0ke2Vudk5hbWV9YCwgLi4ub3RoZXJSZXNvdXJjZXMpO1xyXG5cclxuICAgICAgYXBwTWFuaWZlc3Qubm9kZS5hZGREZXBlbmRlbmN5KG5hbWVzcGFjZU1hbmlmZXN0KTtcclxuXHJcbiAgICAgIGNvbnN0IGZsdWVudEJpdCA9IGNsdXN0ZXIuYWRkSGVsbUNoYXJ0KGBGbHVlbnRCaXQtJHtlbnZOYW1lfWAsIHtcclxuICAgICAgICBjaGFydDogJ2F3cy1mb3ItZmx1ZW50LWJpdCcsXHJcbiAgICAgICAgcmVwb3NpdG9yeTogJ2h0dHBzOi8vYXdzLmdpdGh1Yi5pby9la3MtY2hhcnRzJyxcclxuICAgICAgICByZWxlYXNlOiBgZmx1ZW50LWJpdC0ke2Vudk5hbWV9YCxcclxuICAgICAgICBuYW1lc3BhY2U6ICdhbWF6b24tY2xvdWR3YXRjaCcsXHJcbiAgICAgICAgY3JlYXRlTmFtZXNwYWNlOiBmYWxzZSxcclxuICAgICAgICB2YWx1ZXM6IHtcclxuICAgICAgICAgIC4uLnZhbHVlcywgLy8gSW5qZWN0IHBhcnNlZCB2YWx1ZXMueWFtbCBjb250ZW50XHJcbiAgICAgICAgICBzZXJ2aWNlQWNjb3VudDoge1xyXG4gICAgICAgICAgICBuYW1lOiAnZmx1ZW50LWJpdCcsXHJcbiAgICAgICAgICAgIGFubm90YXRpb25zOiB7XHJcbiAgICAgICAgICAgICAgJ2Vrcy5hbWF6b25hd3MuY29tL3JvbGUtYXJuJzogZmx1ZW50Qml0U2FSb2xlLnJvbGVBcm4sXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgZmx1ZW50Qml0Lm5vZGUuYWRkRGVwZW5kZW5jeShuYW1lc3BhY2VNYW5pZmVzdCk7XHJcbiAgICAgIGlmIChwcmV2aW91c0hlbG1DaGFydCkge1xyXG4gICAgICAgIGZsdWVudEJpdC5ub2RlLmFkZERlcGVuZGVuY3kocHJldmlvdXNIZWxtQ2hhcnQpO1xyXG4gICAgICB9XHJcbiAgICAgIHByZXZpb3VzSGVsbUNoYXJ0ID0gZmx1ZW50Qml0O1xyXG4gICAgfVxyXG59fVxyXG5cclxuIl19