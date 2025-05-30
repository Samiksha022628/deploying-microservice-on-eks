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
        const envName = this.node.tryGetContext('env') || 'dev';
        const envconfigs = this.node.tryGetContext('envconfigs');
        const config = envconfigs[envName];
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
        const placeholders = {
            '{{ENV}}': envName,
            '{{APP_VERSION}}': config.appVersion || '1.0.0',
            '{{REPLICA_COUNT}}': (config.replicaCount || 1).toString(),
            '{{REQUEST_CPU}}': config.requestCpu || '100m',
            '{{LIMIT_CPU}}': config.limitCpu || '200m',
            '{{FEATURE_FLAG}}': config.featureFlag === undefined ? 'false' : config.featureFlag.toString(),
        };
        const resources = files.flatMap(file => {
            const filePath = path.join(manifestsDir, file);
            let content = fs.readFileSync(filePath, 'utf8');
            for (const [key, value] of Object.entries(placeholders)) {
                const regex = new RegExp(key, 'g');
                content = content.replace(regex, value);
            }
            return yaml
                .parseAllDocuments(content)
                .map(doc => doc.toJSON())
                .filter(Boolean);
        });
        cluster.addManifest('AppManifests', ...resources);
    }
}
exports.DeployingMicoserviceOnEksStack = DeployingMicoserviceOnEksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLDZCQUE2QjtBQUM3QixnRkFBb0U7QUFDcEUsMkNBQTJDO0FBRTNDLE1BQWEsOEJBQStCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDM0QsWUFBWSxLQUFlLEVBQUUsRUFBUyxFQUFFLEtBQXFCO1FBQUcsS0FBSyxDQUFDLEtBQUssRUFBQyxFQUFFLEVBQUMsS0FBSyxDQUFDLENBQUM7UUFFcEYsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDO1FBQ3hELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ3pELE1BQU0sTUFBTSxHQUFHLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUVuQyxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQzNELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRTtTQUMxQyxDQUFDLENBQUM7UUFFSixNQUFNLEdBQUcsR0FBQyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFDLEtBQUssRUFBQztZQUM5QixXQUFXLEVBQUUsQ0FBQztZQUNkLG1CQUFtQixFQUFFO2dCQUNuQixFQUFDLElBQUksRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsbUJBQW1CLEVBQUUsUUFBUSxFQUFFLEVBQUUsR0FBRTtnQkFDdEYsRUFBQyxJQUFJ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QyxZQUFZLENBQUMsRUFBRSxDQUFDO2dCQUN4RCxNQUFNLEtBQUssR0FBRyxJQUFJLE1BQU0sQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7Z0JBQ25DLE9BQU8sR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsQ0FBQztZQUMxQyxDQUFDO1lBQ0QsT0FBTyxJQUFJO2lCQUNSLGlCQUFpQixDQUFDLE9BQU8sQ0FBQztpQkFDMUIsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDO2lCQUN4QixNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDckIsQ0FBQyxDQUFDLENBQUM7UUFDRCxPQUFPLENBQUMsV0FBVyxDQUFDLGNBQWMsRUFBRSxHQUFHLFNBQVMsQ0FBQyxDQUFDO0lBQ25ELENBQUM7Q0FBQztBQWhGVCx3RUFnRlMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgZWtzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1la3MnO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcclxuaW1wb3J0ICogYXMgeWFtbCBmcm9tICd5YW1sJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0IHsgS3ViZWN0bFYyOExheWVyIH0gZnJvbSAnQGF3cy1jZGsvbGFtYmRhLWxheWVyLWt1YmVjdGwtdjI4JztcclxuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xyXG5cclxuZXhwb3J0IGNsYXNzIERlcGxveWluZ01pY29zZXJ2aWNlT25Fa3NTdGFjayBleHRlbmRzIGNkay5TdGFja3tcclxuICBjb25zdHJ1Y3RvcihzY29wZTpDb25zdHJ1Y3QsIGlkOnN0cmluZywgcHJvcHM/OmNkay5TdGFja1Byb3BzKSB7c3VwZXIoc2NvcGUsaWQscHJvcHMpO1xyXG5cclxuICAgIGNvbnN0IGVudk5hbWUgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnZW52JykgfHwgJ2Rldic7XHJcbiAgICBjb25zdCBlbnZjb25maWdzID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2VudmNvbmZpZ3MnKTtcclxuICAgIGNvbnN0IGNvbmZpZyA9IGVudmNvbmZpZ3NbZW52TmFtZV07XHJcblxyXG4gICAgY29uc3QgaWFtcm9sZWZvcmNsdXN0ZXIgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0Vrc0FkbWluUm9sZScsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKCksXHJcbiAgICB9KTtcclxuXHJcbiAgIGNvbnN0IHZwYz1uZXcgZWMyLlZwYyh0aGlzLCd2cGMnLHtcclxuICAgICAgbmF0R2F0ZXdheXM6IDEsXHJcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcclxuICAgICAgICB7bmFtZTogJ1ByaXZhdGVTdWJuZXQnLCBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLCBjaWRyTWFzazogMjQsfSxcclxuICAgICAgICB7bmFtZTogJ1B1YmxpY1N1Ym5ldCcsIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQywgY2lkck1hc2s6IDI0LH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjbHVzdGVyPW5ldyBla3MuQ2x1c3Rlcih0aGlzLCAnRWtzQ2x1c3RlcicsIFxyXG4gICAgICAgIHtjbHVzdGVyTmFtZTogJ0Vrc0NsdXN0ZXInLFxyXG4gICAgICAgICAgZGVmYXVsdENhcGFjaXR5OjAsXHJcbiAgICAgICAgICB2cGMsXHJcbiAgICAgICAgICB2ZXJzaW9uOiBla3MuS3ViZXJuZXRlc1ZlcnNpb24uVjFfMjgsXHJcbiAgICAgICAgICBrdWJlY3RsTGF5ZXI6IG5ldyBLdWJlY3RsVjI4TGF5ZXIodGhpcywgJ2t1YmVjdGwnKSxcclxuICAgICAgICAgIHZwY1N1Ym5ldHM6W3tzdWJuZXRUeXBlOmVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1N9XSxcclxuICAgICAgICAgIG1hc3RlcnNSb2xlOmlhbXJvbGVmb3JjbHVzdGVyLFxyXG4gICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIGNvbnN0IG5vZGVncm91cD1jbHVzdGVyLmFkZE5vZGVncm91cENhcGFjaXR5KCdOb2RlR3JvdXAnLHtcclxuICAgICAgICBkZXNpcmVkU2l6ZToyLFxyXG4gICAgICAgIGluc3RhbmNlVHlwZXM6IFtuZXcgZWMyLkluc3RhbmNlVHlwZSgndDMubWVkaXVtJyldLFxyXG4gICAgICAgIHJlbW90ZUFjY2VzczogeyBzc2hLZXlOYW1lOiAnZGVtbycsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBub2RlZ3JvdXAucm9sZS5hZGRNYW5hZ2VkUG9saWN5KGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZVxyXG4gICAgICAgICgnQW1hem9uU1NNTWFuYWdlZEluc3RhbmNlQ29yZScpKTtcclxuICAgICAgXHJcbiAgICAgIGNsdXN0ZXIuYXdzQXV0aC5hZGRSb2xlTWFwcGluZyhub2RlZ3JvdXAucm9sZSwge1xyXG4gICAgICAgIHVzZXJuYW1lOiAnc3lzdGVtOm5vZGU6e3tFQzJQcml2YXRlRE5TTmFtZX19JyxcclxuICAgICAgICBncm91cHM6IFsnc3lzdGVtOmJvb3RzdHJhcHBlcnMnLCAnc3lzdGVtOm5vZGVzJywgJ3N5c3RlbTptYXN0ZXJzJ10sXHJcbiAgICAgfSk7XHJcblxyXG4gICAgICBjbHVzdGVyLmFkZEhlbG1DaGFydCgnTWV0cmljc1NlcnZlcicsIHtcclxuICAgICAgICBjaGFydDogJ21ldHJpY3Mtc2VydmVyJyxcclxuICAgICAgICByZXBvc2l0b3J5OiAnaHR0cHM6Ly9rdWJlcm5ldGVzLXNpZ3MuZ2l0aHViLmlvL21ldHJpY3Mtc2VydmVyLycsXHJcbiAgICAgICAgcmVsZWFzZTogJ21ldHJpY3Mtc2VydmVyJyxcclxuICAgICAgICBuYW1lc3BhY2U6ICdrdWJlLXN5c3RlbScsXHJcbiAgICAgICAgdmFsdWVzOiB7YXJnczogW1xyXG4gICAgICAgICctLWt1YmVsZXQtaW5zZWN1cmUtdGxzJyxcclxuICAgICAgICAnLS1rdWJlbGV0LXByZWZlcnJlZC1hZGRyZXNzLXR5cGVzPUludGVybmFsSVAsSG9zdG5hbWUsRXh0ZXJuYWxJUCcsXSx9LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IG1hbmlmZXN0c0Rpcj0nbWFuaWZlc3RzJztcclxuICAgICAgY29uc3QgZmlsZXMgPVsnbmFtZXNwYWNlLnlhbWwnLCdyb2xlYmluZGluZy55YW1sJywnY29uZmlnTWFwLXNlY3JldC55YW1sJywnZGVwbG95bWVudC55YW1sJywgJ0hQQS55YW1sJywgJ2pvYi55YW1sJ107XHJcblxyXG4gICAgICAgIGNvbnN0IHBsYWNlaG9sZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcclxuICAgICAgICAne3tFTlZ9fSc6IGVudk5hbWUsXHJcbiAgICAgICAgJ3t7QVBQX1ZFUlNJT059fSc6IGNvbmZpZy5hcHBWZXJzaW9uIHx8ICcxLjAuMCcsXHJcbiAgICAgICAgJ3t7UkVQTElDQV9DT1VOVH19JzogKGNvbmZpZy5yZXBsaWNhQ291bnQgfHwgMSkudG9TdHJpbmcoKSxcclxuICAgICAgICAne3tSRVFVRVNUX0NQVX19JzogY29uZmlnLnJlcXVlc3RDcHUgfHwgJzEwMG0nLFxyXG4gICAgICAgICd7e0xJTUlUX0NQVX19JzogY29uZmlnLmxpbWl0Q3B1IHx8ICcyMDBtJyxcclxuICAgICAgICAne3tGRUFUVVJFX0ZMQUd9fSc6IGNvbmZpZy5mZWF0dXJlRmxhZyA9PT0gdW5kZWZpbmVkID8gJ2ZhbHNlJyA6IGNvbmZpZy5mZWF0dXJlRmxhZy50b1N0cmluZygpLFxyXG4gICAgICB9O1xyXG4gICAgXHJcbiAgICAgICAgY29uc3QgcmVzb3VyY2VzID0gZmlsZXMuZmxhdE1hcChmaWxlID0+IHtcclxuICAgICAgICAgIGNvbnN0IGZpbGVQYXRoID0gcGF0aC5qb2luKG1hbmlmZXN0c0RpciwgZmlsZSk7XHJcbiAgICAgICAgICBsZXQgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcclxuXHJcbiAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocGxhY2Vob2xkZXJzKSkge1xyXG4gICAgICAgICAgY29uc3QgcmVnZXggPSBuZXcgUmVnRXhwKGtleSwgJ2cnKTtcclxuICAgICAgICAgIGNvbnRlbnQgPSBjb250ZW50LnJlcGxhY2UocmVnZXgsIHZhbHVlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHlhbWxcclxuICAgICAgICAgIC5wYXJzZUFsbERvY3VtZW50cyhjb250ZW50KVxyXG4gICAgICAgICAgLm1hcChkb2MgPT4gZG9jLnRvSlNPTigpKVxyXG4gICAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcclxuICAgICAgfSk7XHJcbiAgICAgICAgY2x1c3Rlci5hZGRNYW5pZmVzdCgnQXBwTWFuaWZlc3RzJywgLi4ucmVzb3VyY2VzKTtcclxuICAgICAgIH19XHJcbiJdfQ==