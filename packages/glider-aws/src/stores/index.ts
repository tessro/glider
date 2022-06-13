import type { DynamoDB } from 'aws-sdk';

import { ConnectionStore } from './connection';
import { DestinationStore } from './destination';
import { SourceStore } from './source';

export * from './source';
export * from './destination';
export * from './connection';

interface Stores {
  sources: SourceStore;
  destinations: DestinationStore;
  connections: ConnectionStore;
}

interface Options {
  client: DynamoDB.DocumentClient;
  tableName: string;
}

export function makeStores(options: Options): Stores {
  return {
    sources: new SourceStore(options),
    destinations: new DestinationStore(options),
    connections: new ConnectionStore(options),
  };
}
