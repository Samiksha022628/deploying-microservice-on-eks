import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

export class IamAndVpcStack extends cdk.Stack {
  public readonly iamRoleForCluster: iam.Role;
  public readonly vpc: ec2.Vpc;
  constructor(scope:Construct, id:string, props?:cdk.StackProps) {super(scope,id,props);

    this.iamRoleForCluster=new iam.Role(this, 'IamRoleForCluster', {
      assumedBy: new iam.AccountRootPrincipal(),
      managedPolicies: [ iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),],
    });

    this.vpc=new ec2.Vpc(this, 'Vpc', {
      natGateways:1,
      subnetConfiguration:[
        {name: 'PrivateSubnet', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24},
        {name:'PublicSubnet', subnetType:ec2.SubnetType.PUBLIC, cidrMask: 24}
      ] 
    })

  }}
  

