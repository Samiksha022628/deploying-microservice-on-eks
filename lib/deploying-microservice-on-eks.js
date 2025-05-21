"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeployingMicoserviceOnEksStack = void 0;
const cdk = require("aws-cdk-lib");
const eks = require("aws-cdk-lib/aws-eks");
const iam = require("aws-cdk-lib/aws-iam");
const fs = require("fs");
const yaml = require("yaml");
const lambda_layer_kubectl_v28_1 = require("@aws-cdk/lambda-layer-kubectl-v28");
const ec2 = require("aws-cdk-lib/aws-ec2");
class DeployingMicoserviceOnEksStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
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
        const files = ['namespace.yaml', 'rolebinding.yaml', 'configMap-secret.yaml', 'deployment.yaml', 'HPA.yaml'];
        const resources = files.flatMap(file => yaml
            .parseAllDocuments(fs.readFileSync(`${manifestsDir}/${file}`, 'utf-8'))
            .map(doc => doc.toJSON())
            .filter(Boolean));
        cluster.addManifest('AppManifests', ...resources);
    }
}
exports.DeployingMicoserviceOnEksStack = DeployingMicoserviceOnEksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLGdGQUFvRTtBQUNwRSwyQ0FBMkM7QUFFM0MsTUFBYSw4QkFBK0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUMzRCxZQUFZLEtBQWUsRUFBRSxFQUFTLEVBQUUsS0FBcUI7UUFBRyxLQUFLLENBQUMsS0FBSyxFQUFDLEVBQUUsRUFBQyxLQUFLLENBQUMsQ0FBQztRQUVwRixNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQzNELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRTtTQUMxQyxDQUFDLENBQUM7UUFFSixNQUFNLEdBQUcsR0FBQyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFDLEtBQUssRUFBQztZQUM5QixXQUFXLEVBQUUsQ0FBQztZQUNkLG1CQUFtQixFQUFFO2dCQUNuQixFQUFDLElBQUksRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsbUJBQW1CLEVBQUUsUUFBUSxFQUFFLEVBQUUsR0FBRTtnQkFDdEYsRUFBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsRUFBRSxHQUFFO2FBQ3pFO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsTUFBTSxPQUFPLEdBQUMsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQzVDLEVBQUMsV0FBVyxFQUFFLFlBQVk7WUFDeEIsR0FBRztZQUNILE9BQU8sRUFBRSxHQUFHLENBQUMsaUJBQWlCLENBQUMsS0FBSztZQUNwQyxZQUFZLEVBQUUsSUFBSSwwQ0FBZSxDQUFDLElBQUksRUFBRSxTQUFTLENBQUM7WUFDbEQsVUFBVSxFQUFDLENBQUMsRUFBQyxVQUFVLEVBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUIsRUFBQyxDQUFDO1lBQzVELFdBQVcsRUFBQyxpQkFBaUI7U0FDM0IsQ0FBQyxDQUFBO1FBRVAsTUFBTSxTQUFTLEdBQUMsT0FBTyxDQUFDLG9CQUFvQixDQUFDLFdBQVcsRUFBQztZQUN2RCxXQUFXLEVBQUMsQ0FBQztZQUNiLGFBQWEsRUFBRSxDQUFDLElBQUksR0FBRyxDQUFDLFlBQVksQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUNsRCxZQUFZLEVBQUUsRUFBRSxVQUFVLEVBQUUsTUFBTTthQUNqQztTQUNGLENBQUMsQ0FBQztRQUVILFNBQVMsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FDdkUsOEJBQThCLENBQUMsQ0FBQyxDQUFDO1FBRXRDLE9BQU8sQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUU7WUFDN0MsUUFBUSxFQUFFLG1DQUFtQztZQUM3QyxNQUFNLEVBQUUsQ0FBQyxzQkFBc0IsRUFBRSxjQUFjLEVBQUUsZ0JBQWdCLENBQUM7U0FDbkUsQ0FBQyxDQUFDO1FBRUQsT0FBTyxDQUFDLFlBQVksQ0FBQyxlQUFlLEVBQUU7WUFDcEMsS0FBSyxFQUFFLGdCQUFnQjtZQUN2QixVQUFVLEVBQUUsbURBQW1EO1lBQy9ELE9BQU8sRUFBRSxnQkFBZ0I7WUFDekIsU0FBUyxFQUFFLGFBQWE7WUFDeEIsTUFBTSxFQUFFLEVBQUMsSUFBSSxFQUFFO29CQUNmLHdCQUF3QjtvQkFDeEIsa0VBQWtFO2lCQUFFLEdBQUU7U0FDdkUsQ0FBQyxDQUFDO1FBRUQsTUFBTSxZQUFZLEdBQUMsV0FBVyxDQUFDO1FBQy9CLE1BQU0sS0FBSyxHQUFFLENBQUMsZ0JBQWdCLEVBQUMsa0JBQWtCLEVBQUMsdUJBQXVCLEVBQUMsaUJBQWlCLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFFekcsTUFBTSxTQUFTLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUk7YUFDdkMsaUJBQWlCLENBQUMsRUFBRSxDQUFDLFlBQVksQ0FBQyxHQUFHLFlBQVksSUFBSSxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUMsQ0FBQzthQUN0RSxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLENBQUM7YUFDeEIsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUNuQixDQUFDO1FBQ0YsT0FBTyxDQUFDLFdBQVcsQ0FBQyxjQUFjLEVBQUUsR0FBRyxTQUFTLENBQUMsQ0FBQztJQUNuRCxDQUFDO0NBQUM7QUExRFQsd0VBMERTIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIGVrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWtzJztcclxuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcbmltcG9ydCAqIGFzIHlhbWwgZnJvbSAneWFtbCc7XHJcbmltcG9ydCB7IEt1YmVjdGxWMjhMYXllciB9IGZyb20gJ0Bhd3MtY2RrL2xhbWJkYS1sYXllci1rdWJlY3RsLXYyOCc7XHJcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcclxuXHJcbmV4cG9ydCBjbGFzcyBEZXBsb3lpbmdNaWNvc2VydmljZU9uRWtzU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2t7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6Q29uc3RydWN0LCBpZDpzdHJpbmcsIHByb3BzPzpjZGsuU3RhY2tQcm9wcykge3N1cGVyKHNjb3BlLGlkLHByb3BzKTtcclxuXHJcbiAgICBjb25zdCBpYW1yb2xlZm9yY2x1c3RlciA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnRWtzQWRtaW5Sb2xlJywge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQWNjb3VudFJvb3RQcmluY2lwYWwoKSxcclxuICAgIH0pO1xyXG5cclxuICAgY29uc3QgdnBjPW5ldyBlYzIuVnBjKHRoaXMsJ3ZwYycse1xyXG4gICAgICBuYXRHYXRld2F5czogMSxcclxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xyXG4gICAgICAgIHtuYW1lOiAnUHJpdmF0ZVN1Ym5ldCcsIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsIGNpZHJNYXNrOiAyNCx9LFxyXG4gICAgICAgIHtuYW1lOiAnUHVibGljU3VibmV0Jywgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLCBjaWRyTWFzazogMjQsfSxcclxuICAgICAgXSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNsdXN0ZXI9bmV3IGVrcy5DbHVzdGVyKHRoaXMsICdFa3NDbHVzdGVyJywgXHJcbiAgICAgICAge2NsdXN0ZXJOYW1lOiAnRWtzQ2x1c3RlcicsXHJcbiAgICAgICAgICB2cGMsXHJcbiAgICAgICAgICB2ZXJzaW9uOiBla3MuS3ViZXJuZXRlc1ZlcnNpb24uVjFfMjgsXHJcbiAgICAgICAgICBrdWJlY3RsTGF5ZXI6IG5ldyBLdWJlY3RsVjI4TGF5ZXIodGhpcywgJ2t1YmVjdGwnKSxcclxuICAgICAgICAgIHZwY1N1Ym5ldHM6W3tzdWJuZXRUeXBlOmVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1N9XSxcclxuICAgICAgICAgIG1hc3RlcnNSb2xlOmlhbXJvbGVmb3JjbHVzdGVyLFxyXG4gICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIFxyXG4gICAgICBjb25zdCBub2RlZ3JvdXA9Y2x1c3Rlci5hZGROb2RlZ3JvdXBDYXBhY2l0eSgnTm9kZUdyb3VwJyx7XHJcbiAgICAgICAgZGVzaXJlZFNpemU6MixcclxuICAgICAgICBpbnN0YW5jZVR5cGVzOiBbbmV3IGVjMi5JbnN0YW5jZVR5cGUoJ3QzLm1lZGl1bScpXSxcclxuICAgICAgICByZW1vdGVBY2Nlc3M6IHsgc3NoS2V5TmFtZTogJ2RlbW8nLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgbm9kZWdyb3VwLnJvbGUuYWRkTWFuYWdlZFBvbGljeShpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWVcclxuICAgICAgICAoJ0FtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmUnKSk7XHJcbiAgICAgIFxyXG4gICAgY2x1c3Rlci5hd3NBdXRoLmFkZFJvbGVNYXBwaW5nKG5vZGVncm91cC5yb2xlLCB7XHJcbiAgICAgIHVzZXJuYW1lOiAnc3lzdGVtOm5vZGU6e3tFQzJQcml2YXRlRE5TTmFtZX19JyxcclxuICAgICAgZ3JvdXBzOiBbJ3N5c3RlbTpib290c3RyYXBwZXJzJywgJ3N5c3RlbTpub2RlcycsICdzeXN0ZW06bWFzdGVycyddLFxyXG4gICAgfSk7XHJcblxyXG4gICAgICBjbHVzdGVyLmFkZEhlbG1DaGFydCgnTWV0cmljc1NlcnZlcicsIHtcclxuICAgICAgICBjaGFydDogJ21ldHJpY3Mtc2VydmVyJyxcclxuICAgICAgICByZXBvc2l0b3J5OiAnaHR0cHM6Ly9rdWJlcm5ldGVzLXNpZ3MuZ2l0aHViLmlvL21ldHJpY3Mtc2VydmVyLycsXHJcbiAgICAgICAgcmVsZWFzZTogJ21ldHJpY3Mtc2VydmVyJyxcclxuICAgICAgICBuYW1lc3BhY2U6ICdrdWJlLXN5c3RlbScsXHJcbiAgICAgICAgdmFsdWVzOiB7YXJnczogW1xyXG4gICAgICAgICctLWt1YmVsZXQtaW5zZWN1cmUtdGxzJyxcclxuICAgICAgICAnLS1rdWJlbGV0LXByZWZlcnJlZC1hZGRyZXNzLXR5cGVzPUludGVybmFsSVAsSG9zdG5hbWUsRXh0ZXJuYWxJUCcsXSx9LFxyXG4gICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBtYW5pZmVzdHNEaXI9J21hbmlmZXN0cyc7XHJcbiAgICAgICAgY29uc3QgZmlsZXMgPVsnbmFtZXNwYWNlLnlhbWwnLCdyb2xlYmluZGluZy55YW1sJywnY29uZmlnTWFwLXNlY3JldC55YW1sJywnZGVwbG95bWVudC55YW1sJywgJ0hQQS55YW1sJ107XHJcbiAgICBcclxuICAgICAgICBjb25zdCByZXNvdXJjZXMgPSBmaWxlcy5mbGF0TWFwKGZpbGUgPT4geWFtbFxyXG4gICAgICAgICAgICAucGFyc2VBbGxEb2N1bWVudHMoZnMucmVhZEZpbGVTeW5jKGAke21hbmlmZXN0c0Rpcn0vJHtmaWxlfWAsICd1dGYtOCcpKVxyXG4gICAgICAgICAgICAubWFwKGRvYyA9PiBkb2MudG9KU09OKCkpXHJcbiAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbilcclxuICAgICAgICApO1xyXG4gICAgICAgIGNsdXN0ZXIuYWRkTWFuaWZlc3QoJ0FwcE1hbmlmZXN0cycsIC4uLnJlc291cmNlcyk7XHJcbiAgICAgICB9fVxyXG4iXX0=