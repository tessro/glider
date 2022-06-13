import { StackContext } from '@serverless-stack/resources';
import { aws_iam as iam, aws_s3 as s3 } from 'aws-cdk-lib';

import { Service } from '../constructs/Service';

export function CoreStack({ stack }: StackContext) {
  const pluginBucket = new s3.Bucket(stack, 'Plugins', {
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
  });

  const service = new Service(stack, 'Glider', {
    plugins: {
      bucket: pluginBucket,
    },
  });

  const user = new iam.User(stack, 'ApiUser');
  user.attachInlinePolicy(
    new iam.Policy(stack, 'AllowApiAccess', {
      statements: [
        new iam.PolicyStatement({
          actions: ['execute-api:Invoke'],
          effect: iam.Effect.ALLOW,
          resources: [
            `arn:aws:execute-api:${stack.region}:${stack.account}:${service.api.httpApiId}/*`,
          ],
        }),
      ],
    })
  );

  // Allow the API user to read from the plugin bucket, for simplicity in dev
  pluginBucket.grantRead(user);

  const accessKey = new iam.AccessKey(stack, 'ApiUserAccessKey', {
    user,
  });

  stack.addOutputs({
    ApiEndpoint: service.api.url,
    ApiAccessKey: accessKey.accessKeyId,
    ApiAccessSecret: accessKey.secretAccessKey.unsafeUnwrap(),
  });
}
