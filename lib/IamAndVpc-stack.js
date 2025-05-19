"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IamAndVpcStack = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const iam = require("aws-cdk-lib/aws-iam");
class IamAndVpcStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        this.iamRoleForCluster = new iam.Role(this, 'IamRoleForCluster', {
            assumedBy: new iam.AccountRootPrincipal(),
            managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),],
        });
        this.vpc = new ec2.Vpc(this, 'Vpc', {
            natGateways: 1,
            subnetConfiguration: [
                { name: 'PrivateSubnet', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
                { name: 'PublicSubnet', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }
            ]
        });
    }
}
exports.IamAndVpcStack = IamAndVpcStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiSWFtQW5kVnBjLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiSWFtQW5kVnBjLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUVuQywyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBRTNDLE1BQWEsY0FBZSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBRzNDLFlBQVksS0FBZSxFQUFFLEVBQVMsRUFBRSxLQUFxQjtRQUFHLEtBQUssQ0FBQyxLQUFLLEVBQUMsRUFBRSxFQUFDLEtBQUssQ0FBQyxDQUFDO1FBRXBGLElBQUksQ0FBQyxpQkFBaUIsR0FBQyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzdELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRTtZQUN6QyxlQUFlLEVBQUUsQ0FBRSxHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLHdCQUF3QixDQUFDLEVBQUU7U0FDMUYsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLEdBQUcsR0FBQyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUNoQyxXQUFXLEVBQUMsQ0FBQztZQUNiLG1CQUFtQixFQUFDO2dCQUNsQixFQUFDLElBQUksRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsbUJBQW1CLEVBQUUsUUFBUSxFQUFFLEVBQUUsRUFBQztnQkFDckYsRUFBQyxJQUFJLEVBQUMsY0FBYyxFQUFFLFVBQVUsRUFBQyxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsRUFBRSxFQUFDO2FBQ3RFO1NBQ0YsQ0FBQyxDQUFBO0lBRUosQ0FBQztDQUFDO0FBbEJKLHdDQWtCSSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcblxuZXhwb3J0IGNsYXNzIElhbUFuZFZwY1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGlhbVJvbGVGb3JDbHVzdGVyOiBpYW0uUm9sZTtcbiAgcHVibGljIHJlYWRvbmx5IHZwYzogZWMyLlZwYztcbiAgY29uc3RydWN0b3Ioc2NvcGU6Q29uc3RydWN0LCBpZDpzdHJpbmcsIHByb3BzPzpjZGsuU3RhY2tQcm9wcykge3N1cGVyKHNjb3BlLGlkLHByb3BzKTtcblxuICAgIHRoaXMuaWFtUm9sZUZvckNsdXN0ZXI9bmV3IGlhbS5Sb2xlKHRoaXMsICdJYW1Sb2xlRm9yQ2x1c3RlcicsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5BY2NvdW50Um9vdFByaW5jaXBhbCgpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnQW1hem9uRUtTQ2x1c3RlclBvbGljeScpLF0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnZwYz1uZXcgZWMyLlZwYyh0aGlzLCAnVnBjJywge1xuICAgICAgbmF0R2F0ZXdheXM6MSxcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246W1xuICAgICAgICB7bmFtZTogJ1ByaXZhdGVTdWJuZXQnLCBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLCBjaWRyTWFzazogMjR9LFxuICAgICAgICB7bmFtZTonUHVibGljU3VibmV0Jywgc3VibmV0VHlwZTplYzIuU3VibmV0VHlwZS5QVUJMSUMsIGNpZHJNYXNrOiAyNH1cbiAgICAgIF0gXG4gICAgfSlcblxuICB9fVxuICBcblxuIl19