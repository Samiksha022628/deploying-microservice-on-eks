"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeployingMicroserviceOnEksStack = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const eks = require("aws-cdk-lib/aws-eks");
const iam = require("aws-cdk-lib/aws-iam");
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
    }
}
exports.DeployingMicroserviceOnEksStack = DeployingMicroserviceOnEksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95aW5nLW1pY3Jvc2VydmljZS1vbi1la3Mtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXBsb3lpbmctbWljcm9zZXJ2aWNlLW9uLWVrcy1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsZ0ZBQW9FO0FBRXBFLE1BQWEsK0JBQWdDLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDNUQsWUFBWSxLQUFlLEVBQUUsRUFBUyxFQUFFLEtBQXFCO1FBQUcsS0FBSyxDQUFDLEtBQUssRUFBQyxFQUFFLEVBQUMsS0FBSyxDQUFDLENBQUM7UUFFcEYsTUFBTSxpQkFBaUIsR0FBQyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzlELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRTtZQUN6QyxlQUFlLEVBQUUsQ0FBRSxHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLHdCQUF3QixDQUFDLEVBQUU7U0FDMUYsQ0FBQyxDQUFDO1FBRUgsTUFBTSxHQUFHLEdBQUMsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDakMsV0FBVyxFQUFDLENBQUM7WUFDYixtQkFBbUIsRUFBQztnQkFDbEIsRUFBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQixFQUFFLFFBQVEsRUFBRSxFQUFFLEVBQUM7Z0JBQ3JGLEVBQUMsSUFBSSxFQUFDLGNBQWMsRUFBRSxVQUFVLEVBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLEVBQUUsRUFBQzthQUN0RTtTQUNGLENBQUMsQ0FBQTtRQUVGLE1BQU0sT0FBTyxHQUFDLElBQUksR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ2hELEdBQUc7WUFDSCxlQUFlLEVBQUMsQ0FBQztZQUNqQixPQUFPLEVBQUUsR0FBRyxDQUFDLGlCQUFpQixDQUFDLEtBQUs7WUFDcEMsWUFBWSxFQUFFLElBQUksMENBQWUsQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDO1lBQ2xELFVBQVUsRUFBQyxDQUFDLEVBQUMsVUFBVSxFQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsbUJBQW1CLEVBQUMsQ0FBQztZQUM1RCxXQUFXLEVBQUMsaUJBQWlCO1NBQzNCLENBQUMsQ0FBQTtRQUNILE9BQU8sQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLGlCQUFpQixFQUFFO1lBQ2hELE1BQU0sRUFBRSxDQUFDLGdCQUFnQixDQUFDO1NBQzNCLENBQUMsQ0FBQTtJQUdOLENBQUM7Q0FBQztBQTdCSiwwRUE2QkkiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBla3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVrcyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBLdWJlY3RsVjI4TGF5ZXIgfSBmcm9tICdAYXdzLWNkay9sYW1iZGEtbGF5ZXIta3ViZWN0bC12MjgnO1xuXG5leHBvcnQgY2xhc3MgRGVwbG95aW5nTWljcm9zZXJ2aWNlT25Fa3NTdGFjayBleHRlbmRzIGNkay5TdGFja3tcbiAgY29uc3RydWN0b3Ioc2NvcGU6Q29uc3RydWN0LCBpZDpzdHJpbmcsIHByb3BzPzpjZGsuU3RhY2tQcm9wcykge3N1cGVyKHNjb3BlLGlkLHByb3BzKTtcblxuICAgIGNvbnN0IGlhbVJvbGVGb3JDbHVzdGVyPW5ldyBpYW0uUm9sZSh0aGlzLCAnSWFtUm9sZUZvckNsdXN0ZXInLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQWNjb3VudFJvb3RQcmluY2lwYWwoKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogWyBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FtYXpvbkVLU0NsdXN0ZXJQb2xpY3knKSxdLFxuICAgIH0pO1xuXG4gICAgY29uc3QgdnBjPW5ldyBlYzIuVnBjKHRoaXMsICdWcGMnLCB7XG4gICAgICBuYXRHYXRld2F5czoxLFxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjpbXG4gICAgICAgIHtuYW1lOiAnUHJpdmF0ZVN1Ym5ldCcsIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsIGNpZHJNYXNrOiAyNH0sXG4gICAgICAgIHtuYW1lOidQdWJsaWNTdWJuZXQnLCBzdWJuZXRUeXBlOmVjMi5TdWJuZXRUeXBlLlBVQkxJQywgY2lkck1hc2s6IDI0fVxuICAgICAgXVxuICAgIH0pXG5cbiAgICBjb25zdCBjbHVzdGVyPW5ldyBla3MuQ2x1c3Rlcih0aGlzLCAnRWtzQ2x1c3RlcicsIHtcbiAgICAgIHZwYyxcbiAgICAgIGRlZmF1bHRDYXBhY2l0eToyLFxuICAgICAgdmVyc2lvbjogZWtzLkt1YmVybmV0ZXNWZXJzaW9uLlYxXzI4LFxuICAgICAga3ViZWN0bExheWVyOiBuZXcgS3ViZWN0bFYyOExheWVyKHRoaXMsICdrdWJlY3RsJyksXG4gICAgICB2cGNTdWJuZXRzOlt7c3VibmV0VHlwZTplYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTfV0sXG4gICAgICBtYXN0ZXJzUm9sZTppYW1Sb2xlRm9yQ2x1c3RlclxuICAgICAgIH0pXG4gICAgICBjbHVzdGVyLmF3c0F1dGguYWRkUm9sZU1hcHBpbmcoaWFtUm9sZUZvckNsdXN0ZXIsIHtcbiAgICAgICAgZ3JvdXBzOiBbJ3N5c3RlbTptYXN0ZXJzJ11cbiAgICAgIH0pXG4gICAgICBcbiAgIFxuICB9fVxuXG5cblxuIl19