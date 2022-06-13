import * as sst from '@serverless-stack/resources';

import { CoreStack } from './CoreStack';

export default function main(app: sst.App): void {
  // Set default runtime for all functions
  app.setDefaultFunctionProps({
    runtime: 'nodejs16.x',
  });

  app.stack(CoreStack);

  // Add more stacks
}
