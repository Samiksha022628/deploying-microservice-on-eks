import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
export declare class IamAndVpcStack extends cdk.Stack {
    readonly iamRoleForCluster: iam.Role;
    readonly vpc: ec2.Vpc;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
