import {
  aws_apigateway as apigateway,
  aws_iam as iam,
  aws_s3 as s3,
  CfnOutput,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { Service } from './constructs/Service';

export type GliderStackProps = StackProps;

export class GliderStack extends Stack {
  public readonly service: Service;
  public readonly api: apigateway.RestApi;
  public readonly pluginBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: GliderStackProps) {
    super(scope, id, props);

    this.pluginBucket = new s3.Bucket(this, 'Plugins', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    this.service = new Service(this, 'Glider', {
      plugins: {
        bucket: this.pluginBucket,
      },
    });

    this.api = this.service.api;

    const user = new iam.User(this, 'ApiUser');
    this.service.grantApiAccess(user);

    // Allow the API user to read from the plugin bucket, for simplicity in dev
    this.pluginBucket.grantRead(user);

    const accessKey = new iam.AccessKey(this, 'ApiUserAccessKey', {
      user,
    });

    new CfnOutput(this, 'ApiEndpoint', {
      value: this.service.api.url,
    });
    new CfnOutput(this, 'ApiAccessKey', {
      value: accessKey.accessKeyId,
    });
    new CfnOutput(this, 'ApiAccessSecret', {
      value: accessKey.secretAccessKey.unsafeUnwrap(),
    });
    new CfnOutput(this, 'PluginBucketName', {
      value: this.pluginBucket.bucketName,
    });
  }
}
