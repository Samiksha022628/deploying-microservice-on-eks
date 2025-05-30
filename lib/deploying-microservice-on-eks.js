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
            const namespaceManifest = cluster.addManifest(`NamespaceManifest-${envName}`, ...namespaceResources);
            const otherResources = files.flatMap(file => {
                const content = replacePlaceholders(fs.readFileSync(path.join(manifestsDir, file), 'utf8'));
                return yaml.parseAllDocuments(content).map(doc => doc.toJSON()).filter(Boolean);
            });
            const appManifest = cluster.addManifest(`AppManifests-${envName}`, ...otherResources);
            appManifest.node.addDependency(namespaceManifest);
        }
    }
}
exports.DeployingMicoserviceOnEksStack = DeployingMicoserviceOnEksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLDZCQUE2QjtBQUM3QixnRkFBb0U7QUFDcEUsMkNBQTJDO0FBRTNDLE1BQWEsOEJBQStCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDM0QsWUFBWSxLQUFlLEVBQUUsRUFBUyxFQUFFLEtBQXFCO1FBQUcsS0FBSyxDQUFDLEtBQUssRUFBQyxFQUFFLEVBQUMsS0FBSyxDQUFDLENBQUM7UUFFcEYsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFekQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsb0JBQW9CLEVBQUU7U0FDMUMsQ0FBQyxDQUFDO1FBRUosTUFBTSxHQUFHLEdBQUMsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBQyxLQUFLLEVBQUM7WUFDOUIsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkIsRUFBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQixFQUFFLFFBQVEsRUFBRSxFQUFFLEdBQUU7Z0JBQ3RGLEVBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRSxVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLEVBQUUsR0FBRTthQUN6RTtTQUNGLENBQUMsQ0FBQztRQUVILE1BQU0sT0FBTyxHQUFDLElBQUks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YXdzLWNkay1saWInO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgZWtzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1la3MnO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcclxuaW1wb3J0ICogYXMgeWFtbCBmcm9tICd5YW1sJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0IHsgS3ViZWN0bFYyOExheWVyIH0gZnJvbSAnQGF3cy1jZGsvbGFtYmRhLWxheWVyLWt1YmVjdGwtdjI4JztcclxuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xyXG5cclxuZXhwb3J0IGNsYXNzIERlcGxveWluZ01pY29zZXJ2aWNlT25Fa3NTdGFjayBleHRlbmRzIGNkay5TdGFja3tcclxuICBjb25zdHJ1Y3RvcihzY29wZTpDb25zdHJ1Y3QsIGlkOnN0cmluZywgcHJvcHM/OmNkay5TdGFja1Byb3BzKSB7c3VwZXIoc2NvcGUsaWQscHJvcHMpO1xyXG5cclxuICAgIGNvbnN0IGVudmNvbmZpZ3MgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnZW52Y29uZmlncycpO1xyXG5cclxuICAgIGNvbnN0IGlhbXJvbGVmb3JjbHVzdGVyID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdFa3NBZG1pblJvbGUnLCB7XHJcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5BY2NvdW50Um9vdFByaW5jaXBhbCgpLFxyXG4gICAgfSk7XHJcblxyXG4gICBjb25zdCB2cGM9bmV3IGVjMi5WcGModGhpcywndnBjJyx7XHJcbiAgICAgIG5hdEdhdGV3YXlzOiAxLFxyXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXHJcbiAgICAgICAge25hbWU6ICdQcml2YXRlU3VibmV0Jywgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUywgY2lkck1hc2s6IDI0LH0sXHJcbiAgICAgICAge25hbWU6ICdQdWJsaWNTdWJuZXQnLCBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsIGNpZHJNYXNrOiAyNCx9LFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgY2x1c3Rlcj1uZXcgZWtzLkNsdXN0ZXIodGhpcywgJ0Vrc0NsdXN0ZXInLCBcclxuICAgICAgICB7Y2x1c3Rlck5hbWU6ICdFa3NDbHVzdGVyJyxcclxuICAgICAgICAgIGRlZmF1bHRDYXBhY2l0eTowLFxyXG4gICAgICAgICAgdnBjLFxyXG4gICAgICAgICAgdmVyc2lvbjogZWtzLkt1YmVybmV0ZXNWZXJzaW9uLlYxXzI4LFxyXG4gICAgICAgICAga3ViZWN0bExheWVyOiBuZXcgS3ViZWN0bFYyOExheWVyKHRoaXMsICdrdWJlY3RsJyksXHJcbiAgICAgICAgICB2cGNTdWJuZXRzOlt7c3VibmV0VHlwZTplYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTfV0sXHJcbiAgICAgICAgICBtYXN0ZXJzUm9sZTppYW1yb2xlZm9yY2x1c3RlcixcclxuICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICBcclxuICAgICAgICBjb25zdCBub2RlZ3JvdXA9Y2x1c3Rlci5hZGROb2RlZ3JvdXBDYXBhY2l0eSgnTm9kZUdyb3VwJyx7XHJcbiAgICAgICAgZGVzaXJlZFNpemU6MixcclxuICAgICAgICBpbnN0YW5jZVR5cGVzOiBbbmV3IGVjMi5JbnN0YW5jZVR5cGUoJ3QzLm1lZGl1bScpXSxcclxuICAgICAgICByZW1vdGVBY2Nlc3M6IHsgc3NoS2V5TmFtZTogJ2RlbW8nLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgbm9kZWdyb3VwLnJvbGUuYWRkTWFuYWdlZFBvbGljeShpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWVcclxuICAgICAgICAoJ0FtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmUnKSk7XHJcbiAgICAgIFxyXG4gICAgICBjbHVzdGVyLmF3c0F1dGguYWRkUm9sZU1hcHBpbmcobm9kZWdyb3VwLnJvbGUsIHtcclxuICAgICAgICB1c2VybmFtZTogJ3N5c3RlbTpub2RlOnt7RUMyUHJpdmF0ZUROU05hbWV9fScsXHJcbiAgICAgICAgZ3JvdXBzOiBbJ3N5c3RlbTpib290c3RyYXBwZXJzJywgJ3N5c3RlbTpub2RlcycsICdzeXN0ZW06bWFzdGVycyddLFxyXG4gICAgIH0pO1xyXG5cclxuICAgICAgY2x1c3Rlci5hZGRIZWxtQ2hhcnQoJ01ldHJpY3NTZXJ2ZXInLCB7XHJcbiAgICAgICAgY2hhcnQ6ICdtZXRyaWNzLXNlcnZlcicsXHJcbiAgICAgICAgcmVwb3NpdG9yeTogJ2h0dHBzOi8va3ViZXJuZXRlcy1zaWdzLmdpdGh1Yi5pby9tZXRyaWNzLXNlcnZlci8nLFxyXG4gICAgICAgIHJlbGVhc2U6ICdtZXRyaWNzLXNlcnZlcicsXHJcbiAgICAgICAgbmFtZXNwYWNlOiAna3ViZS1zeXN0ZW0nLFxyXG4gICAgICAgIHZhbHVlczoge2FyZ3M6IFtcclxuICAgICAgICAnLS1rdWJlbGV0LWluc2VjdXJlLXRscycsXHJcbiAgICAgICAgJy0ta3ViZWxldC1wcmVmZXJyZWQtYWRkcmVzcy10eXBlcz1JbnRlcm5hbElQLEhvc3RuYW1lLEV4dGVybmFsSVAnLF0sfSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBtYW5pZmVzdHNEaXI9J21hbmlmZXN0cyc7XHJcbiAgICAgIGNvbnN0IGZpbGVzID1bJ3JvbGViaW5kaW5nLnlhbWwnLCdjb25maWdNYXAtc2VjcmV0LnlhbWwnLCdkZXBsb3ltZW50LnlhbWwnLCAnSFBBLnlhbWwnLCAnam9iLnlhbWwnXTtcclxuXHJcbiBmb3IgKGNvbnN0IGVudk5hbWUgb2YgT2JqZWN0LmtleXMoZW52Y29uZmlncykpIHtcclxuICAgICAgY29uc3QgY29uZmlnID0gZW52Y29uZmlnc1tlbnZOYW1lXTtcclxuXHJcbiAgICAgIGNvbnN0IHBsYWNlaG9sZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcclxuICAgICAgICAne3tFTlZ9fSc6IGVudk5hbWUsXHJcbiAgICAgICAgJ3t7QVBQX1ZFUlNJT059fSc6IGNvbmZpZy5hcHBWZXJzaW9uIHx8ICcxLjAuMCcsXHJcbiAgICAgICAgJ3t7UkVQTElDQV9DT1VOVH19JzogKGNvbmZpZy5yZXBsaWNhQ291bnQgfHwgMSkudG9TdHJpbmcoKSxcclxuICAgICAgICAne3tSRVFVRVNUX0NQVX19JzogY29uZmlnLnJlcXVlc3RDcHUgfHwgJzEwMG0nLFxyXG4gICAgICAgICd7e0xJTUlUX0NQVX19JzogY29uZmlnLmxpbWl0Q3B1IHx8ICcyMDBtJyxcclxuICAgICAgICAne3tGRUFUVVJFX0ZMQUd9fSc6IGNvbmZpZy5mZWF0dXJlRmxhZyA9PT0gdW5kZWZpbmVkID8gJ2ZhbHNlJyA6IGNvbmZpZy5mZWF0dXJlRmxhZy50b1N0cmluZygpLFxyXG4gICAgICB9O1xyXG4gICAgXHJcbiAgICBjb25zdCByZXBsYWNlUGxhY2Vob2xkZXJzID0gKGNvbnRlbnQ6IHN0cmluZykgPT4ge1xyXG4gICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwbGFjZWhvbGRlcnMpKSB7XHJcbiAgICAgICAgY29udGVudCA9IGNvbnRlbnQucmVwbGFjZShuZXcgUmVnRXhwKGtleSwgJ2cnKSwgdmFsdWUpO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiBjb250ZW50O1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBuYW1lc3BhY2VZYW1sID0gcmVwbGFjZVBsYWNlaG9sZGVycyhmcy5yZWFkRmlsZVN5bmMocGF0aC5qb2luKG1hbmlmZXN0c0RpciwgJ25hbWVzcGFjZS55YW1sJyksICd1dGY4JykpO1xyXG4gICAgY29uc3QgbmFtZXNwYWNlUmVzb3VyY2VzID0geWFtbC5wYXJzZUFsbERvY3VtZW50cyhuYW1lc3BhY2VZYW1sKS5tYXAoZG9jID0+IGRvYy50b0pTT04oKSkuZmlsdGVyKEJvb2xlYW4pO1xyXG4gICAgY29uc3QgbmFtZXNwYWNlTWFuaWZlc3QgPSBjbHVzdGVyLmFkZE1hbmlmZXN0KGBOYW1lc3BhY2VNYW5pZmVzdC0ke2Vudk5hbWV9YCwgLi4ubmFtZXNwYWNlUmVzb3VyY2VzKTtcclxuXHJcbiAgICBjb25zdCBvdGhlclJlc291cmNlcyA9IGZpbGVzLmZsYXRNYXAoZmlsZSA9PiB7XHJcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSByZXBsYWNlUGxhY2Vob2xkZXJzKGZzLnJlYWRGaWxlU3luYyhwYXRoLmpvaW4obWFuaWZlc3RzRGlyLCBmaWxlKSwgJ3V0ZjgnKSk7XHJcbiAgICAgIHJldHVybiB5YW1sLnBhcnNlQWxsRG9jdW1lbnRzKGNvbnRlbnQpLm1hcChkb2MgPT4gZG9jLnRvSlNPTigpKS5maWx0ZXIoQm9vbGVhbik7XHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBhcHBNYW5pZmVzdCA9IGNsdXN0ZXIuYWRkTWFuaWZlc3QoYEFwcE1hbmlmZXN0cy0ke2Vudk5hbWV9YCwgLi4ub3RoZXJSZXNvdXJjZXMpO1xyXG4gICAgYXBwTWFuaWZlc3Qubm9kZS5hZGREZXBlbmRlbmN5KG5hbWVzcGFjZU1hbmlmZXN0KTtcclxuICB9XHJcbiAgfX1cclxuIl19