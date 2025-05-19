import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
interface EksClusterStackProps extends cdk.StackProps {
}
export declare class EksClusterStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: EksClusterStackProps);
}
export {};
