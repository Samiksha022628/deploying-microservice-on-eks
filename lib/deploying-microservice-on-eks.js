"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeployingMicoserviceOnEksStack = void 0;
const cdk = require("aws-cdk-lib");
const eks = require("aws-cdk-lib/aws-eks");
const fs = require("fs");
const yaml = require("yaml");
const lambda_layer_kubectl_v28_1 = require("@aws-cdk/lambda-layer-kubectl-v28");
const ec2 = require("aws-cdk-lib/aws-ec2");
class DeployingMicoserviceOnEksStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const vpc = new ec2.Vpc(this, 'vpc', {
            natGateways: 1,
            subnetConfiguration: [
                { name: 'PrivateSubnet', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24, },
                { name: 'PublicSubnet', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24, },
            ],
        });
        const cluster = new eks.Cluster(this, 'EksCluster', { clusterName: 'EksCluster',
            vpc,
            defaultCapacity: 2,
            version: eks.KubernetesVersion.V1_28,
            kubectlLayer: new lambda_layer_kubectl_v28_1.KubectlV28Layer(this, 'kubectl'),
            vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLHlCQUF5QjtBQUN6Qiw2QkFBNkI7QUFDN0IsZ0ZBQW9FO0FBQ3BFLDJDQUEyQztBQUUzQyxNQUFhLDhCQUErQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzNELFlBQVksS0FBZSxFQUFFLEVBQVMsRUFBRSxLQUFxQjtRQUFHLEtBQUssQ0FBQyxLQUFLLEVBQUMsRUFBRSxFQUFDLEtBQUssQ0FBQyxDQUFDO1FBRXJGLE1BQU0sR0FBRyxHQUFDLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUMsS0FBSyxFQUFDO1lBQzlCLFdBQVcsRUFBRSxDQUFDO1lBQ2QsbUJBQW1CLEVBQUU7Z0JBQ25CLEVBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRSxVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUIsRUFBRSxRQUFRLEVBQUUsRUFBRSxHQUFFO2dCQUN0RixFQUFDLElBQUksRUFBRSxjQUFjLEVBQUUsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxFQUFFLEdBQUU7YUFDekU7U0FDRixDQUFDLENBQUM7UUFFSCxNQUFNLE9BQU8sR0FBQyxJQUFJLEdBQUcsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFlBQVksRUFDNUMsRUFBQyxXQUFXLEVBQUUsWUFBWTtZQUN4QixHQUFHO1lBQ0gsZUFBZSxFQUFDLENBQUM7WUFDakIsT0FBTyxFQUFFLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLO1lBQ3BDLFlBQVksRUFBRSxJQUFJLDBDQUFlLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQztZQUNsRCxVQUFVLEVBQUMsQ0FBQyxFQUFDLFVBQVUsRUFBQyxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQixFQUFDLENBQUM7U0FDMUQsQ0FBQyxDQUFBO1FBRUwsTUFBTSxZQUFZLEdBQUMsV0FBVyxDQUFDO1FBQy9CLE1BQU0sS0FBSyxHQUFFLENBQUMsZ0JBQWdCLEVBQUMsdUJBQXVCLEVBQUMsaUJBQWlCLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFFdEYsTUFBTSxTQUFTLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUk7YUFDdkMsaUJBQWlCLENBQUMsRUFBRSxDQUFDLFlBQVksQ0FBQyxHQUFHLFlBQVksSUFBSSxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUMsQ0FBQzthQUN0RSxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLENBQUM7YUFDeEIsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUNuQixDQUFDO1FBQ0YsT0FBTyxDQUFDLFdBQVcsQ0FBQyxjQUFjLEVBQUUsR0FBRyxTQUFTLENBQUMsQ0FBQztJQUV0RCxDQUFDO0NBQUM7QUE5Qk4sd0VBOEJNIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIGVrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWtzJztcclxuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xyXG5pbXBvcnQgKiBhcyB5YW1sIGZyb20gJ3lhbWwnO1xyXG5pbXBvcnQgeyBLdWJlY3RsVjI4TGF5ZXIgfSBmcm9tICdAYXdzLWNkay9sYW1iZGEtbGF5ZXIta3ViZWN0bC12MjgnO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcblxyXG5leHBvcnQgY2xhc3MgRGVwbG95aW5nTWljb3NlcnZpY2VPbkVrc1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNre1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOkNvbnN0cnVjdCwgaWQ6c3RyaW5nLCBwcm9wcz86Y2RrLlN0YWNrUHJvcHMpIHtzdXBlcihzY29wZSxpZCxwcm9wcyk7XHJcblxyXG4gICBjb25zdCB2cGM9bmV3IGVjMi5WcGModGhpcywndnBjJyx7XHJcbiAgICAgIG5hdEdhdGV3YXlzOiAxLFxyXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXHJcbiAgICAgICAge25hbWU6ICdQcml2YXRlU3VibmV0Jywgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUywgY2lkck1hc2s6IDI0LH0sXHJcbiAgICAgICAge25hbWU6ICdQdWJsaWNTdWJuZXQnLCBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsIGNpZHJNYXNrOiAyNCx9LFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgY2x1c3Rlcj1uZXcgZWtzLkNsdXN0ZXIodGhpcywgJ0Vrc0NsdXN0ZXInLCBcclxuICAgICAgICB7Y2x1c3Rlck5hbWU6ICdFa3NDbHVzdGVyJyxcclxuICAgICAgICAgIHZwYyxcclxuICAgICAgICAgIGRlZmF1bHRDYXBhY2l0eToyLFxyXG4gICAgICAgICAgdmVyc2lvbjogZWtzLkt1YmVybmV0ZXNWZXJzaW9uLlYxXzI4LFxyXG4gICAgICAgICAga3ViZWN0bExheWVyOiBuZXcgS3ViZWN0bFYyOExheWVyKHRoaXMsICdrdWJlY3RsJyksXHJcbiAgICAgICAgICB2cGNTdWJuZXRzOlt7c3VibmV0VHlwZTplYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTfV0sXHJcbiAgICAgICAgICAgfSlcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBtYW5pZmVzdHNEaXI9J21hbmlmZXN0cyc7XHJcbiAgICAgICAgY29uc3QgZmlsZXMgPVsnbmFtZXNwYWNlLnlhbWwnLCdjb25maWdNYXAtc2VjcmV0LnlhbWwnLCdkZXBsb3ltZW50LnlhbWwnLCAnSFBBLnlhbWwnXTtcclxuICAgIFxyXG4gICAgICAgIGNvbnN0IHJlc291cmNlcyA9IGZpbGVzLmZsYXRNYXAoZmlsZSA9PiB5YW1sXHJcbiAgICAgICAgICAgIC5wYXJzZUFsbERvY3VtZW50cyhmcy5yZWFkRmlsZVN5bmMoYCR7bWFuaWZlc3RzRGlyfS8ke2ZpbGV9YCwgJ3V0Zi04JykpXHJcbiAgICAgICAgICAgIC5tYXAoZG9jID0+IGRvYy50b0pTT04oKSlcclxuICAgICAgICAgICAgLmZpbHRlcihCb29sZWFuKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgY2x1c3Rlci5hZGRNYW5pZmVzdCgnQXBwTWFuaWZlc3RzJywgLi4ucmVzb3VyY2VzKTtcclxuICAgICAgIFxyXG4gICAgfX1cclxuIl19