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
        const namespaceManifestPath = path.join(__dirname, '..', 'manifests', 'namespace-cloudwatch.yaml');
        const namespaceManifestContent = fs.readFileSync(namespaceManifestPath, 'utf8');
        const namespaceDocs = yaml.parseAllDocuments(namespaceManifestContent);
        const namespaceResources = namespaceDocs.map(doc => doc.toJSON()).filter(Boolean);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLDZCQUE2QjtBQUM3QixnRkFBb0U7QUFDcEUsMkNBQTJDO0FBRTNDLE1BQWEsOEJBQStCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDM0QsWUFBWSxLQUFlLEVBQUUsRUFBUyxFQUFFLEtBQXFCO1FBQUcsS0FBSyxDQUFDLEtBQUssRUFBQyxFQUFFLEVBQUMsS0FBSyxDQUFDLENBQUM7UUFFcEYsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFekQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsb0JBQW9CLEVBQUU7U0FDMUMsQ0FBQyxDQUFDO1FBRUosTUFBTSxHQUFHLEdBQUMsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBQyxLQUFLLEVBQUM7WUFDOUIsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkIsRUFBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQixFQUFFLFFBQVEsRUFBRSxFQUFFLEdBQUU7Z0JBQ3RGLEVBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRSxVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLEVBQUUsR0FBRTthQUN6RTtTQUNGLENBQUMsQ0FBQztRQUVILE1BQU0sT0FBTyxHQUFDLElBQUks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QUFDLGlCQUFpQixDQUFDLENBQUM7WUFFbEQsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLFlBQVksQ0FBQyxhQUFhLE9BQU8sRUFBRSxFQUFFO2dCQUM3RCxLQUFLLEVBQUUsb0JBQW9CO2dCQUMzQixVQUFVLEVBQUUsa0NBQWtDO2dCQUM5QyxPQUFPLEVBQUUsY0FBYyxPQUFPLEVBQUU7Z0JBQ2hDLFNBQVMsRUFBRSxtQkFBbUI7Z0JBQzlCLGVBQWUsRUFBRSxLQUFLO2dCQUN0QixNQUFNLEVBQUU7b0JBQ04sY0FBYyxFQUFFO3dCQUNkLE1BQU0sRUFBRSxLQUFLO3dCQUNiLElBQUksRUFBRSxZQUFZO3dCQUNsQixXQUFXLEVBQUU7NEJBQ1gsNEJBQTRCLEVBQUUsZUFBZSxDQUFDLE9BQU87eUJBQ3REO3FCQUNGO29CQUNELFVBQVUsRUFBRTt3QkFDVixPQUFPLEVBQUUsSUFBSTt3QkFDYixZQUFZLEVBQUUsUUFBUSxPQUFPLFdBQVc7d0JBQ3hDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTt3QkFDbkIsZUFBZSxFQUFFLElBQUk7cUJBQ3RCO29CQUNELFdBQVcsRUFBRSxDQUFDOzRCQUNaLEdBQUcsRUFBRSx1Q0FBdUM7NEJBQzVDLE1BQU0sRUFBRSxZQUFZO3lCQUNyQixDQUFDO2lCQUNIO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsU0FBUyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsbUJBQW1CLENBQUMsQ0FBQztRQUNwRCxDQUFDO0lBQ0gsQ0FBQztDQUFDO0FBeEpKLHdFQXdKSSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBla3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVrcyc7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xyXG5pbXBvcnQgKiBhcyB5YW1sIGZyb20gJ3lhbWwnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgeyBLdWJlY3RsVjI4TGF5ZXIgfSBmcm9tICdAYXdzLWNkay9sYW1iZGEtbGF5ZXIta3ViZWN0bC12MjgnO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcblxyXG5leHBvcnQgY2xhc3MgRGVwbG95aW5nTWljb3NlcnZpY2VPbkVrc1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNre1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOkNvbnN0cnVjdCwgaWQ6c3RyaW5nLCBwcm9wcz86Y2RrLlN0YWNrUHJvcHMpIHtzdXBlcihzY29wZSxpZCxwcm9wcyk7XHJcblxyXG4gICAgY29uc3QgZW52Y29uZmlncyA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdlbnZjb25maWdzJyk7XHJcblxyXG4gICAgY29uc3QgaWFtcm9sZWZvcmNsdXN0ZXIgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0Vrc0FkbWluUm9sZScsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKCksXHJcbiAgICB9KTtcclxuXHJcbiAgIGNvbnN0IHZwYz1uZXcgZWMyLlZwYyh0aGlzLCd2cGMnLHtcclxuICAgICAgbmF0R2F0ZXdheXM6IDEsXHJcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcclxuICAgICAgICB7bmFtZTogJ1ByaXZhdGVTdWJuZXQnLCBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLCBjaWRyTWFzazogMjQsfSxcclxuICAgICAgICB7bmFtZTogJ1B1YmxpY1N1Ym5ldCcsIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQywgY2lkck1hc2s6IDI0LH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjbHVzdGVyPW5ldyBla3MuQ2x1c3Rlcih0aGlzLCAnRWtzQ2x1c3RlcicsIFxyXG4gICAgICAgIHtjbHVzdGVyTmFtZTogJ0Vrc0NsdXN0ZXInLFxyXG4gICAgICAgICAgZGVmYXVsdENhcGFjaXR5OjAsXHJcbiAgICAgICAgICB2cGMsXHJcbiAgICAgICAgICB2ZXJzaW9uOiBla3MuS3ViZXJuZXRlc1ZlcnNpb24uVjFfMjgsXHJcbiAgICAgICAgICBrdWJlY3RsTGF5ZXI6IG5ldyBLdWJlY3RsVjI4TGF5ZXIodGhpcywgJ2t1YmVjdGwnKSxcclxuICAgICAgICAgIHZwY1N1Ym5ldHM6W3tzdWJuZXRUeXBlOmVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1N9XSxcclxuICAgICAgICAgIG1hc3RlcnNSb2xlOmlhbXJvbGVmb3JjbHVzdGVyLFxyXG4gICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIGNvbnN0IG5vZGVncm91cD1jbHVzdGVyLmFkZE5vZGVncm91cENhcGFjaXR5KCdOb2RlR3JvdXAnLHtcclxuICAgICAgICBkZXNpcmVkU2l6ZToyLFxyXG4gICAgICAgIGluc3RhbmNlVHlwZXM6IFtuZXcgZWMyLkluc3RhbmNlVHlwZSgndDMubWVkaXVtJyldLFxyXG4gICAgICAgIHJlbW90ZUFjY2VzczogeyBzc2hLZXlOYW1lOiAnZGVtbycsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBub2RlZ3JvdXAucm9sZS5hZGRNYW5hZ2VkUG9saWN5KGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZVxyXG4gICAgICAgICgnQW1hem9uU1NNTWFuYWdlZEluc3RhbmNlQ29yZScpKTtcclxuICAgICAgXHJcbiAgICAgIGNsdXN0ZXIuYXdzQXV0aC5hZGRSb2xlTWFwcGluZyhub2RlZ3JvdXAucm9sZSwge1xyXG4gICAgICAgIHVzZXJuYW1lOiAnc3lzdGVtOm5vZGU6e3tFQzJQcml2YXRlRE5TTmFtZX19JyxcclxuICAgICAgICBncm91cHM6IFsnc3lzdGVtOmJvb3RzdHJhcHBlcnMnLCAnc3lzdGVtOm5vZGVzJywgJ3N5c3RlbTptYXN0ZXJzJ10sXHJcbiAgICAgfSk7XHJcblxyXG4gICAgICBjbHVzdGVyLmFkZEhlbG1DaGFydCgnTWV0cmljc1NlcnZlcicsIHtcclxuICAgICAgICBjaGFydDogJ21ldHJpY3Mtc2VydmVyJyxcclxuICAgICAgICByZXBvc2l0b3J5OiAnaHR0cHM6Ly9rdWJlcm5ldGVzLXNpZ3MuZ2l0aHViLmlvL21ldHJpY3Mtc2VydmVyLycsXHJcbiAgICAgICAgcmVsZWFzZTogJ21ldHJpY3Mtc2VydmVyJyxcclxuICAgICAgICBuYW1lc3BhY2U6ICdrdWJlLXN5c3RlbScsXHJcbiAgICAgICAgdmFsdWVzOiB7YXJnczogW1xyXG4gICAgICAgICctLWt1YmVsZXQtaW5zZWN1cmUtdGxzJyxcclxuICAgICAgICAnLS1rdWJlbGV0LXByZWZlcnJlZC1hZGRyZXNzLXR5cGVzPUludGVybmFsSVAsSG9zdG5hbWUsRXh0ZXJuYWxJUCcsXSx9LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICBjb25zdCBuYW1lc3BhY2VNYW5pZmVzdFBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnbWFuaWZlc3RzJywgJ25hbWVzcGFjZS1jbG91ZHdhdGNoLnlhbWwnKTtcclxuICAgIGNvbnN0IG5hbWVzcGFjZU1hbmlmZXN0Q29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhuYW1lc3BhY2VNYW5pZmVzdFBhdGgsICd1dGY4Jyk7XHJcbiAgICBjb25zdCBuYW1lc3BhY2VEb2NzID0geWFtbC5wYXJzZUFsbERvY3VtZW50cyhuYW1lc3BhY2VNYW5pZmVzdENvbnRlbnQpO1xyXG4gICAgY29uc3QgbmFtZXNwYWNlUmVzb3VyY2VzID0gbmFtZXNwYWNlRG9jcy5tYXAoZG9jID0+IGRvYy50b0pTT04oKSkuZmlsdGVyKEJvb2xlYW4pO1xyXG4gICAgY29uc3QgY2xvdWR3YXRjaE5hbWVzcGFjZSA9IGNsdXN0ZXIuYWRkTWFuaWZlc3QoJ0Nsb3VkV2F0Y2hOYW1lc3BhY2UnLCAuLi5uYW1lc3BhY2VSZXNvdXJjZXMpO1xyXG5cclxuICAgIFxyXG4gICAgY29uc3QgY29uZGl0aW9uSnNvbiA9IG5ldyBjZGsuQ2ZuSnNvbih0aGlzLCAnT0lEQ0NvbmRpdGlvbicsIHtcclxuwqAgICAgIHZhbHVlOiB7XHJcbsKgwqDCoCAgICAgW2Ake2NsdXN0ZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyLm9wZW5JZENvbm5lY3RQcm92aWRlcklzc3Vlcn06c3ViYF06XHJcbsKgwqDCoMKgwqAgICAgICAnc3lzdGVtOnNlcnZpY2VhY2NvdW50OmFtYXpvbi1jbG91ZHdhdGNoOmZsdWVudC1iaXQnLFxyXG7CoCAgICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgZmx1ZW50Qml0U2FSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdGbHVlbnRCaXRJUlNBJywge1xyXG7CoCAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5XZWJJZGVudGl0eVByaW5jaXBhbChcclxuwqDCoMKgICAgICAgY2x1c3Rlci5vcGVuSWRDb25uZWN0UHJvdmlkZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyQXJuLFxyXG7CoMKgwqAgICAgICAge1xyXG7CoMKgwqDCoMKgICAgICAgIFN0cmluZ0VxdWFsczogY29uZGl0aW9uSnNvbixcclxuwqDCoMKgICAgICAgIH1cclxuwqAgICAgICAgKSxcclxuICAgIH0pO1xyXG5cclxuXHJcbiAgICBmbHVlbnRCaXRTYVJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICBcImxvZ3M6Q3JlYXRlTG9nR3JvdXBcIixcclxuICAgICAgICBcImxvZ3M6Q3JlYXRlTG9nU3RyZWFtXCIsXHJcbiAgICAgICAgXCJsb2dzOlB1dExvZ0V2ZW50c1wiLFxyXG4gICAgICAgIFwibG9nczpEZXNjcmliZUxvZ1N0cmVhbXNcIixcclxuICAgICAgXSxcclxuICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9la3MvKmBdLFxyXG4gICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgbWFuaWZlc3RzRGlyPSdtYW5pZmVzdHMnO1xyXG4gICAgICBjb25zdCBmaWxlcyA9WyduYW1lc3BhY2UueWFtbCcsJ3JvbGViaW5kaW5nLnlhbWwnLCdjb25maWdNYXAtc2VjcmV0LnlhbWwnLCdkZXBsb3ltZW50LnlhbWwnLCAnSFBBLnlhbWwnLCAnam9iLnlhbWwnXTtcclxuXHJcbiBmb3IgKGNvbnN0IGVudk5hbWUgb2YgT2JqZWN0LmtleXMoZW52Y29uZmlncykpIHtcclxuICAgICAgY29uc3QgY29uZmlnID0gZW52Y29uZmlnc1tlbnZOYW1lXTtcclxuXHJcbiAgICAgIGNvbnN0IHBsYWNlaG9sZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcclxuICAgICAgICAne3tFTlZ9fSc6IGVudk5hbWUsXHJcbiAgICAgICAgJ3t7QVBQX1ZFUlNJT059fSc6IGNvbmZpZy5hcHBWZXJzaW9uIHx8ICcxLjAuMCcsXHJcbiAgICAgICAgJ3t7UkVQTElDQV9DT1VOVH19JzogKGNvbmZpZy5yZXBsaWNhQ291bnQgfHwgMSkudG9TdHJpbmcoKSxcclxuICAgICAgICAne3tSRVFVRVNUX0NQVX19JzogY29uZmlnLnJlcXVlc3RDcHUgfHwgJzEwMG0nLFxyXG4gICAgICAgICd7e0xJTUlUX0NQVX19JzogY29uZmlnLmxpbWl0Q3B1IHx8ICcyMDBtJyxcclxuICAgICAgICAne3tGRUFUVVJFX0ZMQUd9fSc6IGNvbmZpZy5mZWF0dXJlRmxhZyA9PT0gdW5kZWZpbmVkID8gJ2ZhbHNlJyA6IGNvbmZpZy5mZWF0dXJlRmxhZy50b1N0cmluZygpLFxyXG4gICAgICB9O1xyXG4gICAgXHJcbiAgICAgIGNvbnN0IHJlcGxhY2VQbGFjZWhvbGRlcnMgPSAoY29udGVudDogc3RyaW5nKSA9PiB7XHJcbiAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocGxhY2Vob2xkZXJzKSkge1xyXG4gICAgICAgICAgY29udGVudCA9IGNvbnRlbnQucmVwbGFjZShuZXcgUmVnRXhwKGtleSwgJ2cnKSwgdmFsdWUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAgIHJldHVybiBjb250ZW50O1xyXG4gICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IGFsbFJlc291cmNlcyA9IGZpbGVzLmZsYXRNYXAoKGZpbGUpID0+IHtcclxuICAgICAgICBjb25zdCBjb250ZW50ID0gcmVwbGFjZVBsYWNlaG9sZGVycyhmcy5yZWFkRmlsZVN5bmMocGF0aC5qb2luKG1hbmlmZXN0c0RpciwgZmlsZSksICd1dGY4JylcclxuICAgICAgICApO1xyXG4gICAgICAgIHJldHVybiB5YW1sLnBhcnNlQWxsRG9jdW1lbnRzKGNvbnRlbnQpLm1hcCgoZG9jKSA9PiBkb2MudG9KU09OKCkpLmZpbHRlcihCb29sZWFuKTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBuYW1lc3BhY2VSZXNvdXJjZXMgPSBhbGxSZXNvdXJjZXMuZmlsdGVyKChyZXMpID0+IHJlcy5raW5kID09PSAnTmFtZXNwYWNlJyk7XHJcbiAgICAgIGNvbnN0IG90aGVyUmVzb3VyY2VzID0gYWxsUmVzb3VyY2VzLmZpbHRlcigocmVzKSA9PiByZXMua2luZCAhPT0gJ05hbWVzcGFjZScpO1xyXG5cclxuICAgICAgY29uc3QgbmFtZXNwYWNlTWFuaWZlc3QgPSBjbHVzdGVyLmFkZE1hbmlmZXN0KGBOYW1lc3BhY2VNYW5pZmVzdC0ke2Vudk5hbWV9YCwuLi5uYW1lc3BhY2VSZXNvdXJjZXMpO1xyXG4gICAgICBjb25zdCBhcHBNYW5pZmVzdCA9IGNsdXN0ZXIuYWRkTWFuaWZlc3QoYEFwcE1hbmlmZXN0cy0ke2Vudk5hbWV9YCwuLi5vdGhlclJlc291cmNlcyk7XHJcblxyXG4gICAgICBhcHBNYW5pZmVzdC5ub2RlLmFkZERlcGVuZGVuY3kobmFtZXNwYWNlTWFuaWZlc3QpO1xyXG5cclxuICAgICAgY29uc3QgZmx1ZW50Qml0ID0gY2x1c3Rlci5hZGRIZWxtQ2hhcnQoYEZsdWVudEJpdC0ke2Vudk5hbWV9YCwge1xyXG4gICAgICAgIGNoYXJ0OiAnYXdzLWZvci1mbHVlbnQtYml0JyxcclxuICAgICAgICByZXBvc2l0b3J5OiAnaHR0cHM6Ly9hd3MuZ2l0aHViLmlvL2Vrcy1jaGFydHMnLFxyXG4gICAgICAgIHJlbGVhc2U6IGBmbHVlbnQtYml0LSR7ZW52TmFtZX1gLFxyXG4gICAgICAgIG5hbWVzcGFjZTogJ2FtYXpvbi1jbG91ZHdhdGNoJyxcclxuICAgICAgICBjcmVhdGVOYW1lc3BhY2U6IGZhbHNlLFxyXG4gICAgICAgIHZhbHVlczoge1xyXG4gICAgICAgICAgc2VydmljZUFjY291bnQ6IHtcclxuICAgICAgICAgICAgY3JlYXRlOiBmYWxzZSxcclxuICAgICAgICAgICAgbmFtZTogJ2ZsdWVudC1iaXQnLFxyXG4gICAgICAgICAgICBhbm5vdGF0aW9uczoge1xyXG4gICAgICAgICAgICAgICdla3MuYW1hem9uYXdzLmNvbS9yb2xlLWFybic6IGZsdWVudEJpdFNhUm9sZS5yb2xlQXJuLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIGNsb3VkV2F0Y2g6IHtcclxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiBgL2Vrcy8ke2Vudk5hbWV9L2FwcC1sb2dzYCxcclxuICAgICAgICAgICAgcmVnaW9uOiB0aGlzLnJlZ2lvbixcclxuICAgICAgICAgICAgYXV0b0NyZWF0ZUdyb3VwOiB0cnVlLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIHRvbGVyYXRpb25zOiBbe1xyXG4gICAgICAgICAgICBrZXk6ICdub2RlLXJvbGUua3ViZXJuZXRlcy5pby9jb250cm9sLXBsYW5lJyxcclxuICAgICAgICAgICAgZWZmZWN0OiAnTm9TY2hlZHVsZScsXHJcbiAgICAgICAgICB9XSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGZsdWVudEJpdC5ub2RlLmFkZERlcGVuZGVuY3koY2xvdWR3YXRjaE5hbWVzcGFjZSk7XHJcbiAgICB9XHJcbiAgfX1cclxuXHJcbiJdfQ==