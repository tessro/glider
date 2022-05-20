import { StackContext } from '@serverless-stack/resources';
import { aws_iam as iam } from 'aws-cdk-lib';

import { Service } from '../constructs/Service';

export function CoreStack({ stack }: StackContext) {
  const service = new Service(stack, 'Glider');

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

  const accessKey = new iam.AccessKey(stack, 'ApiUserAccessKey', {
    user,
  });

  stack.addOutputs({
    ApiEndpoint: service.api.url,
    ApiAccessKey: accessKey.accessKeyId,
    ApiAccessSecret: accessKey.secretAccessKey.unsafeUnwrap(),
  });
}
