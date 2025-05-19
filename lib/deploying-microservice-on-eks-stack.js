"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeployingMicroserviceOnEksStack = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const eks = require("aws-cdk-lib/aws-eks");
const iam = require("aws-cdk-lib/aws-iam");
const fs = require("fs");
const yaml = require("yaml");
const lambda_layer_kubectl_v28_1 = require("@aws-cdk/lambda-layer-kubectl-v28");
class DeployingMicroserviceOnEksStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const iamRoleForCluster = new iam.Role(this, 'IamRoleForCluster', {
            assumedBy: new iam.AccountRootPrincipal(),
            managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),],
        });
        const vpc = new ec2.Vpc(this, 'Vpc', {
            natGateways: 1,
            subnetConfiguration: [
                { name: 'PrivateSubnet', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
                { name: 'PublicSubnet', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }
            ]
        });
        const cluster = new eks.Cluster(this, 'EksCluster', {
            clusterName: 'EksCluster',
            vpc,
            defaultCapacity: 2,
            version: eks.KubernetesVersion.V1_28,
            kubectlLayer: new lambda_layer_kubectl_v28_1.KubectlV28Layer(this, 'kubectl'),
            vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
            mastersRole: iamRoleForCluster
        });
        cluster.awsAuth.addRoleMapping(iamRoleForCluster, {
            groups: ['system:masters']
        });
        const manifestsDir = 'manifests';
        const files = ['configMap-secret.yaml', 'deployment.yaml', 'HPA.yaml'];
        const resources = files.flatMap(file => yaml
            .parseAllDocuments(fs.readFileSync(`${manifestsDir}/${file}`, 'utf-8'))
            .map(doc => doc.toJSON())
            .filter(Boolean));
        cluster.addManifest('AppManifests', ...resources);
    }
}
exports.DeployingMicroserviceOnEksStack = DeployingMicroserviceOnEksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3Mtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QixnRkFBb0U7QUFFcEUsTUFBYSwrQkFBZ0MsU0FBUSxHQUFHLENBQUMsS0FBSztJQUM1RCxZQUFZLEtBQWUsRUFBRSxFQUFTLEVBQUUsS0FBcUI7UUFBRyxLQUFLLENBQUMsS0FBSyxFQUFDLEVBQUUsRUFBQyxLQUFLLENBQUMsQ0FBQztRQUVwRixNQUFNLGlCQUFpQixHQUFDLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDOUQsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLG9CQUFvQixFQUFFO1lBQ3pDLGVBQWUsRUFBRSxDQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQUMsd0JBQXdCLENBQUMsRUFBRTtTQUMxRixDQUFDLENBQUM7UUFFSCxNQUFNLEdBQUcsR0FBQyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUNqQyxXQUFXLEVBQUMsQ0FBQztZQUNiLG1CQUFtQixFQUFDO2dCQUNsQixFQUFDLElBQUksRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsbUJBQW1CLEVBQUUsUUFBUSxFQUFFLEVBQUUsRUFBQztnQkFDckYsRUFBQyxJQUFJLEVBQUMsY0FBYyxFQUFFLFVBQVUsRUFBQyxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsRUFBRSxFQUFDO2FBQ3RFO1NBQ0YsQ0FBQyxDQUFBO1FBRUYsTUFBTSxPQUFPLEdBQUMsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDaEQsV0FBVyxFQUFFLFlBQVk7WUFDekIsR0FBRztZQUNILGVBQWUsRUFBQyxDQUFDO1lBQ2pCLE9BQU8sRUFBRSxHQUFHLENBQUMsaUJBQWlCLENBQUMsS0FBSztZQUNwQyxZQUFZLEVBQUUsSUFBSSwwQ0FBZSxDQUFDLElBQUksRUFBRSxTQUFTLENBQUM7WUFDbEQsVUFBVSxFQUFDLENBQUMsRUFBQyxVQUFVLEVBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUIsRUFBQyxDQUFDO1lBQzVELFdBQVcsRUFBQyxpQkFBaUI7U0FDM0IsQ0FBQyxDQUFBO1FBQ0gsT0FBTyxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsaUJBQWlCLEVBQUU7WUFDaEQsTUFBTSxFQUFFLENBQUMsZ0JBQWdCLENBQUM7U0FDM0IsQ0FBQyxDQUFBO1FBRUosTUFBTSxZQUFZLEdBQUMsV0FBVyxDQUFDO1FBQy9CLE1BQU0sS0FBSyxHQUFFLENBQUMsdUJBQXVCLEVBQUMsaUJBQWlCLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFFckUsTUFBTSxTQUFTLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUk7YUFDdkMsaUJBQWlCLENBQUMsRUFBRSxDQUFDLFlBQVksQ0FBQyxHQUFHLFlBQVksSUFBSSxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUMsQ0FBQzthQUN0RSxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLENBQUM7YUFDeEIsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUNuQixDQUFDO1FBQ0YsT0FBTyxDQUFDLFdBQVcsQ0FBQyxjQUFjLEVBQUUsR0FBRyxTQUFTLENBQUMsQ0FBQztJQUVwRCxDQUFDO0NBQUM7QUF2Q0osMEVBdUNJIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgZWtzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1la3MnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgeWFtbCBmcm9tICd5YW1sJztcbmltcG9ydCB7IEt1YmVjdGxWMjhMYXllciB9IGZyb20gJ0Bhd3MtY2RrL2xhbWJkYS1sYXllci1rdWJlY3RsLXYyOCc7XG5cbmV4cG9ydCBjbGFzcyBEZXBsb3lpbmdNaWNyb3NlcnZpY2VPbkVrc1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNre1xuICBjb25zdHJ1Y3RvcihzY29wZTpDb25zdHJ1Y3QsIGlkOnN0cmluZywgcHJvcHM/OmNkay5TdGFja1Byb3BzKSB7c3VwZXIoc2NvcGUsaWQscHJvcHMpO1xuXG4gICAgY29uc3QgaWFtUm9sZUZvckNsdXN0ZXI9bmV3IGlhbS5Sb2xlKHRoaXMsICdJYW1Sb2xlRm9yQ2x1c3RlcicsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5BY2NvdW50Um9vdFByaW5jaXBhbCgpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnQW1hem9uRUtTQ2x1c3RlclBvbGljeScpLF0sXG4gICAgfSk7XG5cbiAgICBjb25zdCB2cGM9bmV3IGVjMi5WcGModGhpcywgJ1ZwYycsIHtcbiAgICAgIG5hdEdhdGV3YXlzOjEsXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOltcbiAgICAgICAge25hbWU6ICdQcml2YXRlU3VibmV0Jywgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUywgY2lkck1hc2s6IDI0fSxcbiAgICAgICAge25hbWU6J1B1YmxpY1N1Ym5ldCcsIHN1Ym5ldFR5cGU6ZWMyLlN1Ym5ldFR5cGUuUFVCTElDLCBjaWRyTWFzazogMjR9XG4gICAgICBdXG4gICAgfSlcblxuICAgIGNvbnN0IGNsdXN0ZXI9bmV3IGVrcy5DbHVzdGVyKHRoaXMsICdFa3NDbHVzdGVyJywge1xuICAgICAgY2x1c3Rlck5hbWU6ICdFa3NDbHVzdGVyJyxcbiAgICAgIHZwYyxcbiAgICAgIGRlZmF1bHRDYXBhY2l0eToyLFxuICAgICAgdmVyc2lvbjogZWtzLkt1YmVybmV0ZXNWZXJzaW9uLlYxXzI4LFxuICAgICAga3ViZWN0bExheWVyOiBuZXcgS3ViZWN0bFYyOExheWVyKHRoaXMsICdrdWJlY3RsJyksXG4gICAgICB2cGNTdWJuZXRzOlt7c3VibmV0VHlwZTplYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTfV0sXG4gICAgICBtYXN0ZXJzUm9sZTppYW1Sb2xlRm9yQ2x1c3RlclxuICAgICAgIH0pXG4gICAgICBjbHVzdGVyLmF3c0F1dGguYWRkUm9sZU1hcHBpbmcoaWFtUm9sZUZvckNsdXN0ZXIsIHtcbiAgICAgICAgZ3JvdXBzOiBbJ3N5c3RlbTptYXN0ZXJzJ11cbiAgICAgIH0pXG4gICAgXG4gICAgY29uc3QgbWFuaWZlc3RzRGlyPSdtYW5pZmVzdHMnO1xuICAgIGNvbnN0IGZpbGVzID1bJ2NvbmZpZ01hcC1zZWNyZXQueWFtbCcsJ2RlcGxveW1lbnQueWFtbCcsICdIUEEueWFtbCddO1xuXG4gICAgY29uc3QgcmVzb3VyY2VzID0gZmlsZXMuZmxhdE1hcChmaWxlID0+IHlhbWxcbiAgICAgICAgLnBhcnNlQWxsRG9jdW1lbnRzKGZzLnJlYWRGaWxlU3luYyhgJHttYW5pZmVzdHNEaXJ9LyR7ZmlsZX1gLCAndXRmLTgnKSlcbiAgICAgICAgLm1hcChkb2MgPT4gZG9jLnRvSlNPTigpKVxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgKTtcbiAgICBjbHVzdGVyLmFkZE1hbmlmZXN0KCdBcHBNYW5pZmVzdHMnLCAuLi5yZXNvdXJjZXMpO1xuICAgXG4gIH19Il19