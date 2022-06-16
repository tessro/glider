import {
  aws_iam as iam,
  aws_s3 as s3,
  CfnOutput,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { Service } from '../constructs/Service';

export type GliderStackProps = StackProps;

export class GliderStack extends Stack {
  constructor(scope: Construct, id: string, props: GliderStackProps) {
    super(scope, id, props);

    const pluginBucket = new s3.Bucket(this, 'Plugins', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    const service = new Service(this, 'Glider', {
      plugins: {
        bucket: pluginBucket,
      },
    });

    const user = new iam.User(this, 'ApiUser');
    user.attachInlinePolicy(
      new iam.Policy(this, 'AllowApiAccess', {
        statements: [
          new iam.PolicyStatement({
            actions: ['execute-api:Invoke'],
            effect: iam.Effect.ALLOW,
            resources: [
              `arn:aws:execute-api:${this.region}:${this.account}:${service.api.restApiId}/*`,
            ],
          }),
        ],
      })
    );

    // Allow the API user to read from the plugin bucket, for simplicity in dev
    pluginBucket.grantRead(user);

    const accessKey = new iam.AccessKey(this, 'ApiUserAccessKey', {
      user,
    });

    new CfnOutput(this, 'ApiEndpoint', {
      value: service.api.url,
    });
    new CfnOutput(this, 'ApiAccessKey', {
      value: accessKey.accessKeyId,
    });
    new CfnOutput(this, 'ApiAccessSecret', {
      value: accessKey.secretAccessKey.unsafeUnwrap(),
    });
    new CfnOutput(this, 'PluginBucketName', {
      value: pluginBucket.bucketName,
    });
  }
}
