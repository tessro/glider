import {
  Constructor,
  CredentialsProvider,
  Source,
  Destination,
} from '@balsahq/glider';
import {
  MysqlDestination,
  S3Destination,
  StdoutDestination,
  FigmaSource,
  GitHubSource,
  GoogleSource,
  JiraSource,
  LinearSource,
  PagerDutySource,
} from '@balsahq/glider-connectors';

export class Registry<T> {
  private entries: Record<string, T> = {};

  register(key: string, item: T): void {
    this.entries[key] = item;
  }

  get(key: string): T | null {
    return this.entries[key] ?? null;
  }
}

export function createSourceRegistry(): Registry<Constructor<Source>> {
  const registry = new Registry<Constructor<Source>>();

  registry.register('figma', FigmaSource);
  registry.register('github', GitHubSource);
  registry.register('google', GoogleSource);
  registry.register('jira', JiraSource);
  registry.register('linear', LinearSource);
  registry.register('pagerduty', PagerDutySource);

  return registry;
}

export function createDestinationRegistry(): Registry<
  Constructor<Destination>
> {
  const registry = new Registry<Constructor<Destination>>();

  registry.register('mysql', MysqlDestination);
  registry.register('s3', S3Destination);
  registry.register('stdout', StdoutDestination);

  return registry;
}
export interface Context {
  credentials: Registry<Constructor<CredentialsProvider>>;
  sources: Registry<Constructor<Source>>;
  destinations: Registry<Constructor<Destination>>;
}

export class InMemoryContext implements Context {
  credentials = new Registry<Constructor<CredentialsProvider>>();
  sources = createSourceRegistry();
  destinations = createDestinationRegistry();
}
