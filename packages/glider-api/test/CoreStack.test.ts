import { App, Stack } from '@serverless-stack/resources';
import { Template } from 'aws-cdk-lib/assertions';

import { CoreStack } from '../stacks/CoreStack';

// Help SST find our Lambdas. This is needed because we reference Lambdas
// relative to this workspace, but Jest runs from the repository root.
process.chdir('packages/glider-api');

test('Core Stack', () => {
  const app = new App();
  const stack = new Stack(app, 'test-stack');
  CoreStack({ app, stack });

  // THEN
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Lambda::Function', 17);
});
