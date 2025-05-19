#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { IamAndVpcStack } from '../lib/IamAndVpc-stack';
import { EksClusterStack } from '../lib/EksCluster-stack';

const app = new cdk.App();
const targetStack = app.node.tryGetContext('stack');
const env = { account: '654654582602', region: 'us-east-1' };

if (targetStack === 'iam-vpc') {
  new IamAndVpcStack(app, 'IamAndVpcStack', { env });}

if (targetStack === 'eks-cluster') {
  new EksClusterStack(app, 'EksClusterStack', { env });}
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */