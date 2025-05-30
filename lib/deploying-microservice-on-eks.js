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
        const manifestsDir = 'manifests';
        const files = ['rolebinding.yaml', 'configMap-secret.yaml', 'deployment.yaml', 'HPA.yaml', 'job.yaml'];
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
            const namespaceYaml = replacePlaceholders(fs.readFileSync(path.join(manifestsDir, 'namespace.yaml'), 'utf8'));
            const namespaceResources = yaml.parseAllDocuments(namespaceYaml).map(doc => doc.toJSON()).filter(Boolean);
            const namespaceManifest = cluster.addManifest('NamespaceManifest-${envName}', ...namespaceResources);
            const otherResources = files.flatMap(file => {
                const content = replacePlaceholders(fs.readFileSync(path.join(manifestsDir, file), 'utf8'));
                return yaml.parseAllDocuments(content).map(doc => doc.toJSON()).filter(Boolean);
            });
            const appManifest = cluster.addManifest('AppManifests-${envName}', ...otherResources);
            appManifest.node.addDependency(namespaceManifest);
        }
    }
}
exports.DeployingMicoserviceOnEksStack = DeployingMicoserviceOnEksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLDZCQUE2QjtBQUM3QixnRkFBb0U7QUFDcEUsMkNBQTJDO0FBRTNDLE1BQWEsOEJBQStCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDM0QsWUFBWSxLQUFlLEVBQUUsRUFBUyxFQUFFLEtBQXFCO1FBQUcsS0FBSyxDQUFDLEtBQUssRUFBQyxFQUFFLEVBQUMsS0FBSyxDQUFDLENBQUM7UUFFcEYsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFekQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsb0JBQW9CLEVBQUU7U0FDMUMsQ0FBQyxDQUFDO1FBRUosTUFBTSxHQUFHLEdBQUMsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBQyxLQUFLLEVBQUM7WUFDOUIsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkIsRUFBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQixFQUFFLFFBQVEsRUFBRSxFQUFFLEdBQUU7Z0JBQ3RGLEVBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRSxVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLEVBQUUsR0FBRTthQUN6RTtTQUNGLENBQUMsQ0FBQztRQUVILE1BQU0sT0FBTyxHQUFDLElBQUks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b3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIGVrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWtzJztcclxuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcbmltcG9ydCAqIGFzIHlhbWwgZnJvbSAneWFtbCc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcbmltcG9ydCB7IEt1YmVjdGxWMjhMYXllciB9IGZyb20gJ0Bhd3MtY2RrL2xhbWJkYS1sYXllci1rdWJlY3RsLXYyOCc7XHJcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcclxuXHJcbmV4cG9ydCBjbGFzcyBEZXBsb3lpbmdNaWNvc2VydmljZU9uRWtzU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2t7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6Q29uc3RydWN0LCBpZDpzdHJpbmcsIHByb3BzPzpjZGsuU3RhY2tQcm9wcykge3N1cGVyKHNjb3BlLGlkLHByb3BzKTtcclxuXHJcbiAgICBjb25zdCBlbnZjb25maWdzID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2VudmNvbmZpZ3MnKTtcclxuXHJcbiAgICBjb25zdCBpYW1yb2xlZm9yY2x1c3RlciA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnRWtzQWRtaW5Sb2xlJywge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQWNjb3VudFJvb3RQcmluY2lwYWwoKSxcclxuICAgIH0pO1xyXG5cclxuICAgY29uc3QgdnBjPW5ldyBlYzIuVnBjKHRoaXMsJ3ZwYycse1xyXG4gICAgICBuYXRHYXRld2F5czogMSxcclxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xyXG4gICAgICAgIHtuYW1lOiAnUHJpdmF0ZVN1Ym5ldCcsIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsIGNpZHJNYXNrOiAyNCx9LFxyXG4gICAgICAgIHtuYW1lOiAnUHVibGljU3VibmV0Jywgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLCBjaWRyTWFzazogMjQsfSxcclxuICAgICAgXSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNsdXN0ZXI9bmV3IGVrcy5DbHVzdGVyKHRoaXMsICdFa3NDbHVzdGVyJywgXHJcbiAgICAgICAge2NsdXN0ZXJOYW1lOiAnRWtzQ2x1c3RlcicsXHJcbiAgICAgICAgICBkZWZhdWx0Q2FwYWNpdHk6MCxcclxuICAgICAgICAgIHZwYyxcclxuICAgICAgICAgIHZlcnNpb246IGVrcy5LdWJlcm5ldGVzVmVyc2lvbi5WMV8yOCxcclxuICAgICAgICAgIGt1YmVjdGxMYXllcjogbmV3IEt1YmVjdGxWMjhMYXllcih0aGlzLCAna3ViZWN0bCcpLFxyXG4gICAgICAgICAgdnBjU3VibmV0czpbe3N1Ym5ldFR5cGU6ZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTU31dLFxyXG4gICAgICAgICAgbWFzdGVyc1JvbGU6aWFtcm9sZWZvcmNsdXN0ZXIsXHJcbiAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgY29uc3Qgbm9kZWdyb3VwPWNsdXN0ZXIuYWRkTm9kZWdyb3VwQ2FwYWNpdHkoJ05vZGVHcm91cCcse1xyXG4gICAgICAgIGRlc2lyZWRTaXplOjIsXHJcbiAgICAgICAgaW5zdGFuY2VUeXBlczogW25ldyBlYzIuSW5zdGFuY2VUeXBlKCd0My5tZWRpdW0nKV0sXHJcbiAgICAgICAgcmVtb3RlQWNjZXNzOiB7IHNzaEtleU5hbWU6ICdkZW1vJyxcclxuICAgICAgICB9LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIG5vZGVncm91cC5yb2xlLmFkZE1hbmFnZWRQb2xpY3koaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lXHJcbiAgICAgICAgKCdBbWF6b25TU01NYW5hZ2VkSW5zdGFuY2VDb3JlJykpO1xyXG4gICAgICBcclxuICAgICAgY2x1c3Rlci5hd3NBdXRoLmFkZFJvbGVNYXBwaW5nKG5vZGVncm91cC5yb2xlLCB7XHJcbiAgICAgICAgdXNlcm5hbWU6ICdzeXN0ZW06bm9kZTp7e0VDMlByaXZhdGVETlNOYW1lfX0nLFxyXG4gICAgICAgIGdyb3VwczogWydzeXN0ZW06Ym9vdHN0cmFwcGVycycsICdzeXN0ZW06bm9kZXMnLCAnc3lzdGVtOm1hc3RlcnMnXSxcclxuICAgICB9KTtcclxuXHJcbiAgICAgIGNsdXN0ZXIuYWRkSGVsbUNoYXJ0KCdNZXRyaWNzU2VydmVyJywge1xyXG4gICAgICAgIGNoYXJ0OiAnbWV0cmljcy1zZXJ2ZXInLFxyXG4gICAgICAgIHJlcG9zaXRvcnk6ICdodHRwczovL2t1YmVybmV0ZXMtc2lncy5naXRodWIuaW8vbWV0cmljcy1zZXJ2ZXIvJyxcclxuICAgICAgICByZWxlYXNlOiAnbWV0cmljcy1zZXJ2ZXInLFxyXG4gICAgICAgIG5hbWVzcGFjZTogJ2t1YmUtc3lzdGVtJyxcclxuICAgICAgICB2YWx1ZXM6IHthcmdzOiBbXHJcbiAgICAgICAgJy0ta3ViZWxldC1pbnNlY3VyZS10bHMnLFxyXG4gICAgICAgICctLWt1YmVsZXQtcHJlZmVycmVkLWFkZHJlc3MtdHlwZXM9SW50ZXJuYWxJUCxIb3N0bmFtZSxFeHRlcm5hbElQJyxdLH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgbWFuaWZlc3RzRGlyPSdtYW5pZmVzdHMnO1xyXG4gICAgICBjb25zdCBmaWxlcyA9Wydyb2xlYmluZGluZy55YW1sJywnY29uZmlnTWFwLXNlY3JldC55YW1sJywnZGVwbG95bWVudC55YW1sJywgJ0hQQS55YW1sJywgJ2pvYi55YW1sJ107XHJcblxyXG4gZm9yIChjb25zdCBlbnZOYW1lIG9mIE9iamVjdC5rZXlzKGVudmNvbmZpZ3MpKSB7XHJcbiAgICAgIGNvbnN0IGNvbmZpZyA9IGVudmNvbmZpZ3NbZW52TmFtZV07XHJcblxyXG4gICAgICBjb25zdCBwbGFjZWhvbGRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XHJcbiAgICAgICAgJ3t7RU5WfX0nOiBlbnZOYW1lLFxyXG4gICAgICAgICd7e0FQUF9WRVJTSU9OfX0nOiBjb25maWcuYXBwVmVyc2lvbiB8fCAnMS4wLjAnLFxyXG4gICAgICAgICd7e1JFUExJQ0FfQ09VTlR9fSc6IChjb25maWcucmVwbGljYUNvdW50IHx8IDEpLnRvU3RyaW5nKCksXHJcbiAgICAgICAgJ3t7UkVRVUVTVF9DUFV9fSc6IGNvbmZpZy5yZXF1ZXN0Q3B1IHx8ICcxMDBtJyxcclxuICAgICAgICAne3tMSU1JVF9DUFV9fSc6IGNvbmZpZy5saW1pdENwdSB8fCAnMjAwbScsXHJcbiAgICAgICAgJ3t7RkVBVFVSRV9GTEFHfX0nOiBjb25maWcuZmVhdHVyZUZsYWcgPT09IHVuZGVmaW5lZCA/ICdmYWxzZScgOiBjb25maWcuZmVhdHVyZUZsYWcudG9TdHJpbmcoKSxcclxuICAgICAgfTtcclxuICAgIFxyXG4gICAgY29uc3QgcmVwbGFjZVBsYWNlaG9sZGVycyA9IChjb250ZW50OiBzdHJpbmcpID0+IHtcclxuICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocGxhY2Vob2xkZXJzKSkge1xyXG4gICAgICAgIGNvbnRlbnQgPSBjb250ZW50LnJlcGxhY2UobmV3IFJlZ0V4cChrZXksICdnJyksIHZhbHVlKTtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gY29udGVudDtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgbmFtZXNwYWNlWWFtbCA9IHJlcGxhY2VQbGFjZWhvbGRlcnMoZnMucmVhZEZpbGVTeW5jKHBhdGguam9pbihtYW5pZmVzdHNEaXIsICduYW1lc3BhY2UueWFtbCcpLCAndXRmOCcpKTtcclxuICAgIGNvbnN0IG5hbWVzcGFjZVJlc291cmNlcyA9IHlhbWwucGFyc2VBbGxEb2N1bWVudHMobmFtZXNwYWNlWWFtbCkubWFwKGRvYyA9PiBkb2MudG9KU09OKCkpLmZpbHRlcihCb29sZWFuKTtcclxuICAgIGNvbnN0IG5hbWVzcGFjZU1hbmlmZXN0ID0gY2x1c3Rlci5hZGRNYW5pZmVzdCgnTmFtZXNwYWNlTWFuaWZlc3QtJHtlbnZOYW1lfScsIC4uLm5hbWVzcGFjZVJlc291cmNlcyk7XHJcblxyXG4gICAgY29uc3Qgb3RoZXJSZXNvdXJjZXMgPSBmaWxlcy5mbGF0TWFwKGZpbGUgPT4ge1xyXG4gICAgICBjb25zdCBjb250ZW50ID0gcmVwbGFjZVBsYWNlaG9sZGVycyhmcy5yZWFkRmlsZVN5bmMocGF0aC5qb2luKG1hbmlmZXN0c0RpciwgZmlsZSksICd1dGY4JykpO1xyXG4gICAgICByZXR1cm4geWFtbC5wYXJzZUFsbERvY3VtZW50cyhjb250ZW50KS5tYXAoZG9jID0+IGRvYy50b0pTT04oKSkuZmlsdGVyKEJvb2xlYW4pO1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYXBwTWFuaWZlc3QgPSBjbHVzdGVyLmFkZE1hbmlmZXN0KCdBcHBNYW5pZmVzdHMtJHtlbnZOYW1lfScsIC4uLm90aGVyUmVzb3VyY2VzKTtcclxuICAgIGFwcE1hbmlmZXN0Lm5vZGUuYWRkRGVwZW5kZW5jeShuYW1lc3BhY2VNYW5pZmVzdCk7XHJcbiAgfVxyXG4gIH19XHJcbiJdfQ==