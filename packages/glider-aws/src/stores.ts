import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { ConnectionStore } from './stores/connection.js';
import { DestinationStore } from './stores/destination.js';
import { SourceStore } from './stores/source.js';

export * from './stores/source.js';
export * from './stores/destination.js';
export * from './stores/connection.js';

interface Stores {
  sources: SourceStore;
  destinations: DestinationStore;
  connections: ConnectionStore;
}

interface Options {
  client: DynamoDBDocumentClient;
  tableName: string;
}

export function makeStores(options: Options): Stores {
  return {
    sources: new SourceStore(options),
    destinations: new DestinationStore(options),
    connections: new ConnectionStore(options),
  };
}
