import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';
import * as yaml from 'yaml';
import { KubectlV28Layer } from '@aws-cdk/lambda-layer-kubectl-v28';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class DeployingMicoserviceOnEksStack extends cdk.Stack{
  constructor(scope:Construct, id:string, props?:cdk.StackProps) {super(scope,id,props);

    const iamroleforcluster = new iam.Role(this, 'EksAdminRole', {
      assumedBy: new iam.AccountRootPrincipal(),
    });

   const vpc=new ec2.Vpc(this,'vpc',{
      natGateways: 1,
      subnetConfiguration: [
        {name: 'PrivateSubnet', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24,},
        {name: 'PublicSubnet', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24,},
      ],
    });

    const cluster=new eks.Cluster(this, 'EksCluster', 
        {clusterName: 'EksCluster',
          vpc,
          version: eks.KubernetesVersion.V1_28,
          kubectlLayer: new KubectlV28Layer(this, 'kubectl'),
          vpcSubnets:[{subnetType:ec2.SubnetType.PRIVATE_WITH_EGRESS}],
          mastersRole:iamroleforcluster,
           })
            
           
      const nodegroup=cluster.addNodegroupCapacity('NodeGroup',{
        desiredSize:2,
        instanceTypes: [new ec2.InstanceType('t3.medium')],
        remoteAccess: { sshKeyName: 'demo',
        },
      });

      nodegroup.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName
        ('AmazonSSMManagedInstanceCore'));
      
    cluster.awsAuth.addRoleMapping(nodegroup.role, {
      username: 'system:node:{{EC2PrivateDNSName}}',
      groups: ['system:bootstrappers', 'system:nodes', 'system:masters'],
    });

      cluster.addHelmChart('MetricsServer', {
        chart: 'metrics-server',
        repository: 'https://kubernetes-sigs.github.io/metrics-server/',
        release: 'metrics-server',
        namespace: 'kube-system',
        values: {args: [
        '--kubelet-insecure-tls',
        '--kubelet-preferred-address-types=InternalIP,Hostname,ExternalIP',],},
      });
        
        const manifestsDir='manifests';
        const files =['namespace.yaml','rolebinding.yaml','configMap-secret.yaml','deployment.yaml', 'HPA.yaml'];
    
        const resources = files.flatMap(file => yaml
            .parseAllDocuments(fs.readFileSync(`${manifestsDir}/${file}`, 'utf-8'))
            .map(doc => doc.toJSON())
            .filter(Boolean)
        );
        cluster.addManifest('AppManifests', ...resources);
       }}
