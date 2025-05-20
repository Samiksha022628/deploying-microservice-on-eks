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
        const files = ['namespace.yaml', 'configMap-secret.yaml', 'deployment.yaml', 'HPA.yaml'];
        const resources = files.flatMap(file => yaml
            .parseAllDocuments(fs.readFileSync(`${manifestsDir}/${file}`, 'utf-8'))
            .map(doc => doc.toJSON())
            .filter(Boolean));
        cluster.addManifest('AppManifests', ...resources);
    }
}
exports.DeployingMicoserviceOnEksStack = DeployingMicoserviceOnEksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLGdGQUFvRTtBQUNwRSwyQ0FBMkM7QUFFM0MsTUFBYSw4QkFBK0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUMzRCxZQUFZLEtBQWUsRUFBRSxFQUFTLEVBQUUsS0FBcUI7UUFBRyxLQUFLLENBQUMsS0FBSyxFQUFDLEVBQUUsRUFBQyxLQUFLLENBQUMsQ0FBQztRQUVwRixNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQzNELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRTtTQUMxQyxDQUFDLENBQUM7UUFFSixNQUFNLEdBQUcsR0FBQyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFDLEtBQUssRUFBQztZQUM5QixXQUFXLEVBQUUsQ0FBQztZQUNkLG1CQUFtQixFQUFFO2dCQUNuQixFQUFDLElBQUksRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsbUJBQW1CLEVBQUUsUUFBUSxFQUFFLEVBQUUsR0FBRTtnQkFDdEYsRUFBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsRUFBRSxHQUFFO2FBQ3pFO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsTUFBTSxPQUFPLEdBQUMsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQzVDLEVBQUMsV0FBVyxFQUFFLFlBQVk7WUFDeEIsR0FBRztZQUNILE9BQU8sRUFBRSxHQUFHLENBQUMsaUJBQWlCLENBQUMsS0FBSztZQUNwQyxZQUFZLEVBQUUsSUFBSSwwQ0FBZSxDQUFDLElBQUksRUFBRSxTQUFTLENBQUM7WUFDbEQsVUFBVSxFQUFDLENBQUMsRUFBQyxVQUFVLEVBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUIsRUFBQyxDQUFDO1lBQzVELFdBQVcsRUFBQyxpQkFBaUI7U0FDM0IsQ0FBQyxDQUFBO1FBRVAsTUFBTSxTQUFTLEdBQUMsT0FBTyxDQUFDLG9CQUFvQixDQUFDLFdBQVcsRUFBQztZQUN2RCxXQUFXLEVBQUMsQ0FBQztZQUNiLGFBQWEsRUFBRSxDQUFDLElBQUksR0FBRyxDQUFDLFlBQVksQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUNsRCxZQUFZLEVBQUUsRUFBRSxVQUFVLEVBQUUsTUFBTTthQUNqQztTQUNGLENBQUMsQ0FBQztRQUVILFNBQVMsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FDdkUsOEJBQThCLENBQUMsQ0FBQyxDQUFDO1FBRXBDLE9BQU8sQ0FBQyxZQUFZLENBQUMsZUFBZSxFQUFFO1lBQ3BDLEtBQUssRUFBRSxnQkFBZ0I7WUFDdkIsVUFBVSxFQUFFLG1EQUFtRDtZQUMvRCxPQUFPLEVBQUUsZ0JBQWdCO1lBQ3pCLFNBQVMsRUFBRSxhQUFhO1lBQ3hCLE1BQU0sRUFBRSxFQUFDLElBQUksRUFBRTtvQkFDZix3QkFBd0I7b0JBQ3hCLGtFQUFrRTtpQkFBRSxHQUFFO1NBQ3ZFLENBQUMsQ0FBQztRQUVELE1BQU0sWUFBWSxHQUFDLFdBQVcsQ0FBQztRQUMvQixNQUFNLEtBQUssR0FBRSxDQUFDLGdCQUFnQixFQUFDLHVCQUF1QixFQUFDLGlCQUFpQixFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBRXRGLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJO2FBQ3ZDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQyxZQUFZLENBQUMsR0FBRyxZQUFZLElBQUksSUFBSSxFQUFFLEVBQUUsT0FBTyxDQUFDLENBQUM7YUFDdEUsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDO2FBQ3hCLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FDbkIsQ0FBQztRQUNGLE9BQU8sQ0FBQyxXQUFXLENBQUMsY0FBYyxFQUFFLEdBQUcsU0FBUyxDQUFDLENBQUM7SUFDbkQsQ0FBQztDQUFDO0FBckRULHdFQXFEUyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBla3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVrcyc7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xyXG5pbXBvcnQgKiBhcyB5YW1sIGZyb20gJ3lhbWwnO1xyXG5pbXBvcnQgeyBLdWJlY3RsVjI4TGF5ZXIgfSBmcm9tICdAYXdzLWNkay9sYW1iZGEtbGF5ZXIta3ViZWN0bC12MjgnO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcblxyXG5leHBvcnQgY2xhc3MgRGVwbG95aW5nTWljb3NlcnZpY2VPbkVrc1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNre1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOkNvbnN0cnVjdCwgaWQ6c3RyaW5nLCBwcm9wcz86Y2RrLlN0YWNrUHJvcHMpIHtzdXBlcihzY29wZSxpZCxwcm9wcyk7XHJcblxyXG4gICAgY29uc3QgaWFtcm9sZWZvcmNsdXN0ZXIgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0Vrc0FkbWluUm9sZScsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKCksXHJcbiAgICB9KTtcclxuXHJcbiAgIGNvbnN0IHZwYz1uZXcgZWMyLlZwYyh0aGlzLCd2cGMnLHtcclxuICAgICAgbmF0R2F0ZXdheXM6IDEsXHJcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcclxuICAgICAgICB7bmFtZTogJ1ByaXZhdGVTdWJuZXQnLCBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLCBjaWRyTWFzazogMjQsfSxcclxuICAgICAgICB7bmFtZTogJ1B1YmxpY1N1Ym5ldCcsIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQywgY2lkck1hc2s6IDI0LH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjbHVzdGVyPW5ldyBla3MuQ2x1c3Rlcih0aGlzLCAnRWtzQ2x1c3RlcicsIFxyXG4gICAgICAgIHtjbHVzdGVyTmFtZTogJ0Vrc0NsdXN0ZXInLFxyXG4gICAgICAgICAgdnBjLFxyXG4gICAgICAgICAgdmVyc2lvbjogZWtzLkt1YmVybmV0ZXNWZXJzaW9uLlYxXzI4LFxyXG4gICAgICAgICAga3ViZWN0bExheWVyOiBuZXcgS3ViZWN0bFYyOExheWVyKHRoaXMsICdrdWJlY3RsJyksXHJcbiAgICAgICAgICB2cGNTdWJuZXRzOlt7c3VibmV0VHlwZTplYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTfV0sXHJcbiAgICAgICAgICBtYXN0ZXJzUm9sZTppYW1yb2xlZm9yY2x1c3RlcixcclxuICAgICAgICAgICB9KVxyXG4gICAgICBcclxuICAgICAgY29uc3Qgbm9kZWdyb3VwPWNsdXN0ZXIuYWRkTm9kZWdyb3VwQ2FwYWNpdHkoJ05vZGVHcm91cCcse1xyXG4gICAgICAgIGRlc2lyZWRTaXplOjIsXHJcbiAgICAgICAgaW5zdGFuY2VUeXBlczogW25ldyBlYzIuSW5zdGFuY2VUeXBlKCd0My5tZWRpdW0nKV0sXHJcbiAgICAgICAgcmVtb3RlQWNjZXNzOiB7IHNzaEtleU5hbWU6ICdkZW1vJyxcclxuICAgICAgICB9LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIG5vZGVncm91cC5yb2xlLmFkZE1hbmFnZWRQb2xpY3koaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lXHJcbiAgICAgICAgKCdBbWF6b25TU01NYW5hZ2VkSW5zdGFuY2VDb3JlJykpO1xyXG5cclxuICAgICAgY2x1c3Rlci5hZGRIZWxtQ2hhcnQoJ01ldHJpY3NTZXJ2ZXInLCB7XHJcbiAgICAgICAgY2hhcnQ6ICdtZXRyaWNzLXNlcnZlcicsXHJcbiAgICAgICAgcmVwb3NpdG9yeTogJ2h0dHBzOi8va3ViZXJuZXRlcy1zaWdzLmdpdGh1Yi5pby9tZXRyaWNzLXNlcnZlci8nLFxyXG4gICAgICAgIHJlbGVhc2U6ICdtZXRyaWNzLXNlcnZlcicsXHJcbiAgICAgICAgbmFtZXNwYWNlOiAna3ViZS1zeXN0ZW0nLFxyXG4gICAgICAgIHZhbHVlczoge2FyZ3M6IFtcclxuICAgICAgICAnLS1rdWJlbGV0LWluc2VjdXJlLXRscycsXHJcbiAgICAgICAgJy0ta3ViZWxldC1wcmVmZXJyZWQtYWRkcmVzcy10eXBlcz1JbnRlcm5hbElQLEhvc3RuYW1lLEV4dGVybmFsSVAnLF0sfSxcclxuICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgbWFuaWZlc3RzRGlyPSdtYW5pZmVzdHMnO1xyXG4gICAgICAgIGNvbnN0IGZpbGVzID1bJ25hbWVzcGFjZS55YW1sJywnY29uZmlnTWFwLXNlY3JldC55YW1sJywnZGVwbG95bWVudC55YW1sJywgJ0hQQS55YW1sJ107XHJcbiAgICBcclxuICAgICAgICBjb25zdCByZXNvdXJjZXMgPSBmaWxlcy5mbGF0TWFwKGZpbGUgPT4geWFtbFxyXG4gICAgICAgICAgICAucGFyc2VBbGxEb2N1bWVudHMoZnMucmVhZEZpbGVTeW5jKGAke21hbmlmZXN0c0Rpcn0vJHtmaWxlfWAsICd1dGYtOCcpKVxyXG4gICAgICAgICAgICAubWFwKGRvYyA9PiBkb2MudG9KU09OKCkpXHJcbiAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbilcclxuICAgICAgICApO1xyXG4gICAgICAgIGNsdXN0ZXIuYWRkTWFuaWZlc3QoJ0FwcE1hbmlmZXN0cycsIC4uLnJlc291cmNlcyk7XHJcbiAgICAgICB9fVxyXG4iXX0=