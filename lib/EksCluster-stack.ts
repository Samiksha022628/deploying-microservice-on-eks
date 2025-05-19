import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';
import * as yaml from 'yaml';
import { KubectlV28Layer } from '@aws-cdk/lambda-layer-kubectl-v28';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

interface EksClusterStackProps extends cdk.StackProps {}

export class EksClusterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: EksClusterStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', {
      vpcId: cdk.Fn.importValue('VpcId'),
    });
    
    const iamRoleForCluster = iam.Role.fromRoleArn(
      this,
      'ImportedIamRole',
      cdk.Fn.importValue('IamRoleArn'),
      {mutable: false,
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
    
    const manifestsDir='manifests';
    const files =['configMap-secret.yaml','deployment.yaml', 'HPA.yaml'];

    const resources = files.flatMap(file => yaml
        .parseAllDocuments(fs.readFileSync(`${manifestsDir}/${file}`, 'utf-8'))
        .map(doc => doc.toJSON())
        .filter(Boolean)
    );
    cluster.addManifest('AppManifests', ...resources);
   
  }}