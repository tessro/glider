import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { GliderStack } from '../src/infrastructure/stack.js';

test('Core Stack', () => {
  const app = new App();
  const stack = new GliderStack(app, 'TestStack', {});

  // THEN
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Lambda::Function', 22);
});
