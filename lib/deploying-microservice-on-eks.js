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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLHlCQUF5QjtBQUN6Qiw2QkFBNkI7QUFDN0IsZ0ZBQW9FO0FBQ3BFLDJDQUEyQztBQUUzQyxNQUFhLDhCQUErQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzNELFlBQVksS0FBZSxFQUFFLEVBQVMsRUFBRSxLQUFxQjtRQUFHLEtBQUssQ0FBQyxLQUFLLEVBQUMsRUFBRSxFQUFDLEtBQUssQ0FBQyxDQUFDO1FBRXJGLE1BQU0sR0FBRyxHQUFDLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUMsS0FBSyxFQUFDO1lBQzlCLFdBQVcsRUFBRSxDQUFDO1lBQ2QsbUJBQW1CLEVBQUU7Z0JBQ25CO29CQUNFLElBQUksRUFBRSxlQUFlO29CQUNyQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUI7b0JBQzlDLFFBQVEsRUFBRSxFQUFFO2lCQUNiO2dCQUNEO29CQUNFLElBQUksRUFBRSxjQUFjO29CQUNwQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNO29CQUNqQyxRQUFRLEVBQUUsRUFBRTtpQkFDYjthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsTUFBTSxPQUFPLEdBQUMsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDNUMsV0FBVyxFQUFFLFlBQVk7WUFDekIsR0FBRztZQUNILGVBQWUsRUFBQyxDQUFDO1lBQ2pCLE9BQU8sRUFBRSxHQUFHLENBQUMsaUJBQWlCLENBQUMsS0FBSztZQUNwQyxZQUFZLEVBQUUsSUFBSSwwQ0FBZSxDQUFDLElBQUksRUFBRSxTQUFTLENBQUM7WUFDbEQsVUFBVSxFQUFDLENBQUMsRUFBQyxVQUFVLEVBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUIsRUFBQyxDQUFDO1NBQzFELENBQUMsQ0FBQTtRQUVMLE1BQU0sWUFBWSxHQUFDLFdBQVcsQ0FBQztRQUMvQixNQUFNLEtBQUssR0FBRSxDQUFDLGdCQUFnQixFQUFDLHVCQUF1QixFQUFDLGlCQUFpQixFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBRXRGLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJO2FBQ3ZDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQyxZQUFZLENBQUMsR0FBRyxZQUFZLElBQUksSUFBSSxFQUFFLEVBQUUsT0FBTyxDQUFDLENBQUM7YUFDdEUsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDO2FBQ3hCLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FDbkIsQ0FBQztRQUNGLE9BQU8sQ0FBQyxXQUFXLENBQUMsY0FBYyxFQUFFLEdBQUcsU0FBUyxDQUFDLENBQUM7SUFFcEQsQ0FBQztDQUFDO0FBdENSLHdFQXNDUSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBla3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVrcyc7XHJcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcclxuaW1wb3J0ICogYXMgeWFtbCBmcm9tICd5YW1sJztcclxuaW1wb3J0IHsgS3ViZWN0bFYyOExheWVyIH0gZnJvbSAnQGF3cy1jZGsvbGFtYmRhLWxheWVyLWt1YmVjdGwtdjI4JztcclxuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xyXG5cclxuZXhwb3J0IGNsYXNzIERlcGxveWluZ01pY29zZXJ2aWNlT25Fa3NTdGFjayBleHRlbmRzIGNkay5TdGFja3tcclxuICBjb25zdHJ1Y3RvcihzY29wZTpDb25zdHJ1Y3QsIGlkOnN0cmluZywgcHJvcHM/OmNkay5TdGFja1Byb3BzKSB7c3VwZXIoc2NvcGUsaWQscHJvcHMpO1xyXG5cclxuICAgY29uc3QgdnBjPW5ldyBlYzIuVnBjKHRoaXMsJ3ZwYycse1xyXG4gICAgICBuYXRHYXRld2F5czogMSxcclxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIG5hbWU6ICdQcml2YXRlU3VibmV0JyxcclxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXHJcbiAgICAgICAgICBjaWRyTWFzazogMjQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICBuYW1lOiAnUHVibGljU3VibmV0JyxcclxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcclxuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcclxuICAgICAgICB9LFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgY2x1c3Rlcj1uZXcgZWtzLkNsdXN0ZXIodGhpcywgJ0Vrc0NsdXN0ZXInLCB7XHJcbiAgICAgICAgICBjbHVzdGVyTmFtZTogJ0Vrc0NsdXN0ZXInLFxyXG4gICAgICAgICAgdnBjLFxyXG4gICAgICAgICAgZGVmYXVsdENhcGFjaXR5OjIsXHJcbiAgICAgICAgICB2ZXJzaW9uOiBla3MuS3ViZXJuZXRlc1ZlcnNpb24uVjFfMjgsXHJcbiAgICAgICAgICBrdWJlY3RsTGF5ZXI6IG5ldyBLdWJlY3RsVjI4TGF5ZXIodGhpcywgJ2t1YmVjdGwnKSxcclxuICAgICAgICAgIHZwY1N1Ym5ldHM6W3tzdWJuZXRUeXBlOmVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1N9XSxcclxuICAgICAgICAgICB9KVxyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IG1hbmlmZXN0c0Rpcj0nbWFuaWZlc3RzJztcclxuICAgICAgICBjb25zdCBmaWxlcyA9WyduYW1lc3BhY2UueWFtbCcsJ2NvbmZpZ01hcC1zZWNyZXQueWFtbCcsJ2RlcGxveW1lbnQueWFtbCcsICdIUEEueWFtbCddO1xyXG4gICAgXHJcbiAgICAgICAgY29uc3QgcmVzb3VyY2VzID0gZmlsZXMuZmxhdE1hcChmaWxlID0+IHlhbWxcclxuICAgICAgICAgICAgLnBhcnNlQWxsRG9jdW1lbnRzKGZzLnJlYWRGaWxlU3luYyhgJHttYW5pZmVzdHNEaXJ9LyR7ZmlsZX1gLCAndXRmLTgnKSlcclxuICAgICAgICAgICAgLm1hcChkb2MgPT4gZG9jLnRvSlNPTigpKVxyXG4gICAgICAgICAgICAuZmlsdGVyKEJvb2xlYW4pXHJcbiAgICAgICAgKTtcclxuICAgICAgICBjbHVzdGVyLmFkZE1hbmlmZXN0KCdBcHBNYW5pZmVzdHMnLCAuLi5yZXNvdXJjZXMpO1xyXG4gICAgICAgXHJcbiAgICAgIH19XHJcbiJdfQ==