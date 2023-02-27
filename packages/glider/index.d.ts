/* eslint-disable @typescript-eslint/no-explicit-any */

export type Constructor<T> = new (...args: any[]) => T;

declare module '@balsahq/glider' {
  export const version: string;

  export interface PluginExports {
    activate?(context: PluginContext);
  }

  export interface PluginContext {
    options: any;
  }

  export interface CredentialsProvider {
    get(): any | Promise<any>;
  }

  export interface Context<P = any> {
    credentials: any;
    parent?: P;
  }

  export interface Request {
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  }

  export interface Stream<C = any> {
    name: string;
    parent?: Stream;

    seed: string | Request | ((context: C) => string | Request);
    next?(
      response: Response,
      records: unknown[],
      context: C
    ): string | Request | null;

    transform?(raw: unknown, context: C): unknown[];
  }

  export interface Source {
    name: string;
    headers?:
      | Record<string, string>
      | ((context: Context) => Record<string, string>);
    requestSpacing?: number | ((response: Response) => number);
    streams: Stream[];
  }

  export interface DestinationContext {
    jobId: string;
    sourceOptions: any;
    destinationOptions: any;
  }

  export interface Destination {
    name: string;

    open?(): Promise<void>;
    close?(): Promise<void>;

    write(
      source: string,
      stream: string,
      records: unknown[],
      retrievedAt: number,
      context: DestinationContext
    ): void | Promise<void>;
  }

  export namespace credentials {
    export function registerProvider(
      id: string,
      constructor: Constructor<CredentialsProvider>
    );
  }

  export namespace destinations {
    export function register(id: string, constructor: Constructor<Destination>);
  }
}
