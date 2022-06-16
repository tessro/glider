import { spawnSync } from 'node:child_process';

import { fromSSO } from '@aws-sdk/credential-provider-sso';

const getCredentials = fromSSO({
  profile: process.env.AWS_PROFILE ?? 'sandbox',
});
getCredentials().then((credentials) => {
  const { accessKeyId, secretAccessKey } = credentials;
  spawnSync(
    'docker',
    [
      'run',
      '-p',
      '8083:8083',
      '-e',
      'AWS_DEFAULT_REGON=us-west-2',
      '-e',
      `AWS_ACCESS_KEY_ID=${accessKeyId}`,
      '-e',
      `AWS_SECRET_ACCESS_KEY=${secretAccessKey}`,
      '-e',
      'LAMBDA_ENDPOINT=http://localhost:3000',
      'amazon/aws-stepfunctions-local',
    ],
    { stdio: 'inherit' }
  );
});
