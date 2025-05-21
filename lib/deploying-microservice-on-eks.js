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
        const files = ['namespace.yaml', 'rolebinding.yaml', 'configMap-secret.yaml', 'deployment.yaml', 'HPA.yaml', 'job.yaml'];
        const resources = files.flatMap(file => yaml
            .parseAllDocuments(fs.readFileSync(`${manifestsDir}/${file}`, 'utf-8'))
            .map(doc => doc.toJSON())
            .filter(Boolean));
        cluster.addManifest('AppManifests', ...resources);
    }
}
exports.DeployingMicoserviceOnEksStack = DeployingMicoserviceOnEksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLGdGQUFvRTtBQUNwRSwyQ0FBMkM7QUFFM0MsTUFBYSw4QkFBK0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUMzRCxZQUFZLEtBQWUsRUFBRSxFQUFTLEVBQUUsS0FBcUI7UUFBRyxLQUFLLENBQUMsS0FBSyxFQUFDLEVBQUUsRUFBQyxLQUFLLENBQUMsQ0FBQztRQUVwRixNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQzNELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRTtTQUMxQyxDQUFDLENBQUM7UUFFSixNQUFNLEdBQUcsR0FBQyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFDLEtBQUssRUFBQztZQUM5QixXQUFXLEVBQUUsQ0FBQztZQUNkLG1CQUFtQixFQUFFO2dCQUNuQixFQUFDLElBQUksRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsbUJBQW1CLEVBQUUsUUFBUSxFQUFFLEVBQUUsR0FBRTtnQkFDdEYsRUFBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsRUFBRSxHQUFFO2FBQ3pFO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsTUFBTSxPQUFPLEdBQUMsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQzVDLEVBQUMsV0FBVyxFQUFFLFlBQVk7WUFDeEIsZUFBZSxFQUFDLENBQUM7WUFDakIsR0FBRztZQUNILE9BQU8sRUFBRSxHQUFHLENBQUMsaUJBQWlCLENBQUMsS0FBSztZQUNwQyxZQUFZLEVBQUUsSUFBSSwwQ0FBZSxDQUFDLElBQUksRUFBRSxTQUFTLENBQUM7WUFDbEQsVUFBVSxFQUFDLENBQUMsRUFBQyxVQUFVLEVBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUIsRUFBQyxDQUFDO1lBQzVELFdBQVcsRUFBQyxpQkFBaUI7U0FDM0IsQ0FBQyxDQUFBO1FBRUwsTUFBTSxTQUFTLEdBQUMsT0FBTyxDQUFDLG9CQUFvQixDQUFDLFdBQVcsRUFBQztZQUN6RCxXQUFXLEVBQUMsQ0FBQztZQUNiLGFBQWEsRUFBRSxDQUFDLElBQUksR0FBRyxDQUFDLFlBQVksQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUNsRCxZQUFZLEVBQUUsRUFBRSxVQUFVLEVBQUUsTUFBTTthQUNqQztTQUNGLENBQUMsQ0FBQztRQUVILFNBQVMsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FDdkUsOEJBQThCLENBQUMsQ0FBQyxDQUFDO1FBRXBDLE9BQU8sQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUU7WUFDN0MsUUFBUSxFQUFFLG1DQUFtQztZQUM3QyxNQUFNLEVBQUUsQ0FBQyxzQkFBc0IsRUFBRSxjQUFjLEVBQUUsZ0JBQWdCLENBQUM7U0FDckUsQ0FBQyxDQUFDO1FBRUQsT0FBTyxDQUFDLFlBQVksQ0FBQyxlQUFlLEVBQUU7WUFDcEMsS0FBSyxFQUFFLGdCQUFnQjtZQUN2QixVQUFVLEVBQUUsbURBQW1EO1lBQy9ELE9BQU8sRUFBRSxnQkFBZ0I7WUFDekIsU0FBUyxFQUFFLGFBQWE7WUFDeEIsTUFBTSxFQUFFLEVBQUMsSUFBSSxFQUFFO29CQUNmLHdCQUF3QjtvQkFDeEIsa0VBQWtFO2lCQUFFLEdBQUU7U0FDdkUsQ0FBQyxDQUFDO1FBRUQsTUFBTSxZQUFZLEdBQUMsV0FBVyxDQUFDO1FBQy9CLE1BQU0sS0FBSyxHQUFFLENBQUMsZ0JBQWdCLEVBQUMsa0JBQWtCLEVBQUMsdUJBQXVCLEVBQUMsaUJBQWlCLEVBQUUsVUFBVSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBRXJILE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJO2FBQ3ZDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQyxZQUFZLENBQUMsR0FBRyxZQUFZLElBQUksSUFBSSxFQUFFLEVBQUUsT0FBTyxDQUFDLENBQUM7YUFDdEUsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDO2FBQ3hCLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FDbkIsQ0FBQztRQUNGLE9BQU8sQ0FBQyxXQUFXLENBQUMsY0FBYyxFQUFFLEdBQUcsU0FBUyxDQUFDLENBQUM7SUFDbkQsQ0FBQztDQUFDO0FBM0RULHdFQTJEUyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBla3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVrcyc7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xyXG5pbXBvcnQgKiBhcyB5YW1sIGZyb20gJ3lhbWwnO1xyXG5pbXBvcnQgeyBLdWJlY3RsVjI4TGF5ZXIgfSBmcm9tICdAYXdzLWNkay9sYW1iZGEtbGF5ZXIta3ViZWN0bC12MjgnO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcblxyXG5leHBvcnQgY2xhc3MgRGVwbG95aW5nTWljb3NlcnZpY2VPbkVrc1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNre1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOkNvbnN0cnVjdCwgaWQ6c3RyaW5nLCBwcm9wcz86Y2RrLlN0YWNrUHJvcHMpIHtzdXBlcihzY29wZSxpZCxwcm9wcyk7XHJcblxyXG4gICAgY29uc3QgaWFtcm9sZWZvcmNsdXN0ZXIgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0Vrc0FkbWluUm9sZScsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKCksXHJcbiAgICB9KTtcclxuXHJcbiAgIGNvbnN0IHZwYz1uZXcgZWMyLlZwYyh0aGlzLCd2cGMnLHtcclxuICAgICAgbmF0R2F0ZXdheXM6IDEsXHJcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcclxuICAgICAgICB7bmFtZTogJ1ByaXZhdGVTdWJuZXQnLCBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLCBjaWRyTWFzazogMjQsfSxcclxuICAgICAgICB7bmFtZTogJ1B1YmxpY1N1Ym5ldCcsIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQywgY2lkck1hc2s6IDI0LH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjbHVzdGVyPW5ldyBla3MuQ2x1c3Rlcih0aGlzLCAnRWtzQ2x1c3RlcicsIFxyXG4gICAgICAgIHtjbHVzdGVyTmFtZTogJ0Vrc0NsdXN0ZXInLFxyXG4gICAgICAgICAgZGVmYXVsdENhcGFjaXR5OjAsXHJcbiAgICAgICAgICB2cGMsXHJcbiAgICAgICAgICB2ZXJzaW9uOiBla3MuS3ViZXJuZXRlc1ZlcnNpb24uVjFfMjgsXHJcbiAgICAgICAgICBrdWJlY3RsTGF5ZXI6IG5ldyBLdWJlY3RsVjI4TGF5ZXIodGhpcywgJ2t1YmVjdGwnKSxcclxuICAgICAgICAgIHZwY1N1Ym5ldHM6W3tzdWJuZXRUeXBlOmVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1N9XSxcclxuICAgICAgICAgIG1hc3RlcnNSb2xlOmlhbXJvbGVmb3JjbHVzdGVyLFxyXG4gICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIGNvbnN0IG5vZGVncm91cD1jbHVzdGVyLmFkZE5vZGVncm91cENhcGFjaXR5KCdOb2RlR3JvdXAnLHtcclxuICAgICAgICBkZXNpcmVkU2l6ZToyLFxyXG4gICAgICAgIGluc3RhbmNlVHlwZXM6IFtuZXcgZWMyLkluc3RhbmNlVHlwZSgndDMubWVkaXVtJyldLFxyXG4gICAgICAgIHJlbW90ZUFjY2VzczogeyBzc2hLZXlOYW1lOiAnZGVtbycsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBub2RlZ3JvdXAucm9sZS5hZGRNYW5hZ2VkUG9saWN5KGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZVxyXG4gICAgICAgICgnQW1hem9uU1NNTWFuYWdlZEluc3RhbmNlQ29yZScpKTtcclxuICAgICAgXHJcbiAgICAgIGNsdXN0ZXIuYXdzQXV0aC5hZGRSb2xlTWFwcGluZyhub2RlZ3JvdXAucm9sZSwge1xyXG4gICAgICAgIHVzZXJuYW1lOiAnc3lzdGVtOm5vZGU6e3tFQzJQcml2YXRlRE5TTmFtZX19JyxcclxuICAgICAgICBncm91cHM6IFsnc3lzdGVtOmJvb3RzdHJhcHBlcnMnLCAnc3lzdGVtOm5vZGVzJywgJ3N5c3RlbTptYXN0ZXJzJ10sXHJcbiAgICB9KTtcclxuXHJcbiAgICAgIGNsdXN0ZXIuYWRkSGVsbUNoYXJ0KCdNZXRyaWNzU2VydmVyJywge1xyXG4gICAgICAgIGNoYXJ0OiAnbWV0cmljcy1zZXJ2ZXInLFxyXG4gICAgICAgIHJlcG9zaXRvcnk6ICdodHRwczovL2t1YmVybmV0ZXMtc2lncy5naXRodWIuaW8vbWV0cmljcy1zZXJ2ZXIvJyxcclxuICAgICAgICByZWxlYXNlOiAnbWV0cmljcy1zZXJ2ZXInLFxyXG4gICAgICAgIG5hbWVzcGFjZTogJ2t1YmUtc3lzdGVtJyxcclxuICAgICAgICB2YWx1ZXM6IHthcmdzOiBbXHJcbiAgICAgICAgJy0ta3ViZWxldC1pbnNlY3VyZS10bHMnLFxyXG4gICAgICAgICctLWt1YmVsZXQtcHJlZmVycmVkLWFkZHJlc3MtdHlwZXM9SW50ZXJuYWxJUCxIb3N0bmFtZSxFeHRlcm5hbElQJyxdLH0sXHJcbiAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IG1hbmlmZXN0c0Rpcj0nbWFuaWZlc3RzJztcclxuICAgICAgICBjb25zdCBmaWxlcyA9WyduYW1lc3BhY2UueWFtbCcsJ3JvbGViaW5kaW5nLnlhbWwnLCdjb25maWdNYXAtc2VjcmV0LnlhbWwnLCdkZXBsb3ltZW50LnlhbWwnLCAnSFBBLnlhbWwnLCAnam9iLnlhbWwnXTtcclxuICAgIFxyXG4gICAgICAgIGNvbnN0IHJlc291cmNlcyA9IGZpbGVzLmZsYXRNYXAoZmlsZSA9PiB5YW1sXHJcbiAgICAgICAgICAgIC5wYXJzZUFsbERvY3VtZW50cyhmcy5yZWFkRmlsZVN5bmMoYCR7bWFuaWZlc3RzRGlyfS8ke2ZpbGV9YCwgJ3V0Zi04JykpXHJcbiAgICAgICAgICAgIC5tYXAoZG9jID0+IGRvYy50b0pTT04oKSlcclxuICAgICAgICAgICAgLmZpbHRlcihCb29sZWFuKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgY2x1c3Rlci5hZGRNYW5pZmVzdCgnQXBwTWFuaWZlc3RzJywgLi4ucmVzb3VyY2VzKTtcclxuICAgICAgIH19XHJcbiJdfQ==