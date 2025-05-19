import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import { KubectlV28Layer } from '@aws-cdk/lambda-layer-kubectl-v28';

export class DeployingMicroserviceOnEksStack extends cdk.Stack{
  constructor(scope:Construct, id:string, props?:cdk.StackProps) {super(scope,id,props);

    const iamRoleForCluster=new iam.Role(this, 'IamRoleForCluster', {
      assumedBy: new iam.AccountRootPrincipal(),
      managedPolicies: [ iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),],
    });

    const vpc=new ec2.Vpc(this, 'Vpc', {
      natGateways:1,
      subnetConfiguration:[
        {name: 'PrivateSubnet', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24},
        {name:'PublicSubnet', subnetType:ec2.SubnetType.PUBLIC, cidrMask: 24}
      ]
    })

    const cluster=new eks.Cluster(this, 'EksCluster', {
      clusterName: 'EksCluster',
      vpc,
      defaultCapacity:2,
      version: eks.KubernetesVersion.V1_28,
      kubectlLayer: new KubectlV28Layer(this, 'kubectl'),
      vpcSubnets:[{subnetType:ec2.SubnetType.PRIVATE_WITH_EGRESS}],
      mastersRole:iamRoleForCluster
       })
      cluster.awsAuth.addRoleMapping(iamRoleForCluster, {
        groups: ['system:masters']
      })
      
   
  }}



