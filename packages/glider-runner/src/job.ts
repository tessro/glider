import { Response } from '@glider/connectors';
import {
  Context as ConnectorContext,
  Destination,
  Source,
  Stream,
  CredentialsProvider,
} from 'glider';
import got from 'got';
import pino, { Logger } from 'pino';

import { Context } from './context';
import { sleep } from './utils';

interface JobOptions {
  id: string;
  context: Context;
  credentials: Record<string, any>;
  source: Source;
  destination: Destination;
  logger?: Logger;
}

function defaultTransform(raw: string): unknown[] {
  const data = JSON.parse(raw);
  if (Array.isArray(data)) {
    return data;
  } else {
    return [data];
  }
}

const DEFAULT_REQUEST_SPACING = 500;

function getRequestSpacing(source: Source, response: Response): number {
  if (typeof source.requestSpacing === 'function') {
    return source.requestSpacing(response);
  } else {
    return source.requestSpacing ?? DEFAULT_REQUEST_SPACING;
  }
}

function getSeed(stream: Stream, context: unknown): string {
  if (typeof stream.seed === 'function') {
    return stream.seed(context);
  } else {
    return stream.seed;
  }
}

export class Job {
  readonly id: string;

  private readonly source: Source;
  private readonly destination: Destination;

  private readonly context: Context;
  private readonly credentials: Record<string, CredentialsProvider>;
  private readonly logger: Logger;

  constructor(private readonly options: JobOptions) {
    this.id = options.id;
    this.source = options.source;
    this.destination = options.destination;
    this.context = options.context;
    this.credentials = options.credentials;
    this.logger = options.logger ?? pino();
  }

  async run(): Promise<void> {
    this.logger.info({
      msg: `Starting job ${this.id} (${this.source.name} -> ${this.destination.name})`,
      id: this.id,
      source: this.source.name,
      destination: this.destination.name,
    });

    this.destination.open?.();

    for (const stream of this.source.streams) {
      await this.execStream(stream);
    }

    this.destination.close?.();

    this.logger.info({
      msg: `Finished job ${this.id} (${this.source.name} -> ${this.destination.name})`,
      id: this.id,
      source: this.source.name,
      destination: this.destination.name,
    });
  }

  async execStream(stream: Stream): Promise<void> {
    return this.readStream(stream, {}, async (records) => {
      const now = Date.now();
      await this.destination.write(
        this.id,
        this.source.name,
        stream.name,
        records,
        now
      );
    });
  }

  async readStream(
    stream: Stream,
    context: unknown,
    callback: (records: unknown[]) => void
  ): Promise<void> {
    if (stream.parent) {
      await this.readStream(stream.parent, {}, async (records: unknown[]) => {
        for (const record of records) {
          await this.readStreamInternal(stream, record, callback);
        }
      });
    } else {
      await this.readStreamInternal(stream, context, callback);
    }
  }

  async readStreamInternal(
    stream: Stream,
    context: unknown,
    callback: (records: unknown[]) => void
  ): Promise<void> {
    const headers = await this.getHeaders();
    const transform = stream.transform ?? defaultTransform;

    this.logger.info({
      msg: `Starting stream '${stream.name}'`,
    });

    let url = getSeed(stream, context);
    while (url) {
      this.logger.info({ msg: `Fetching '${url}'`, url });
      const response = await got(url, { headers, throwHttpErrors: false });

      const responseForSource = {
        url,
        body: response.body,
        headers: response.headers,
        statusCode: response.statusCode,
      };

      if (response.statusCode >= 200 && response.statusCode < 300) {
        const records = transform(response.body, context);
        await callback(records);
        this.logger.info({ url, records: records.length });

        if (!stream.next) break;

        const nextUrl = stream.next(responseForSource, records, context);
        if (!nextUrl) break;

        url = nextUrl;
      } else {
        this.logger.warn({
          msg: `Received ${response.statusCode} while fetching '${url}'`,
          url,
          headers,
          statusCode: response.statusCode,
          response: response.body,
        });
      }

      // NOTE(ptr): We only sleep when we are going to fetch another page. This
      // means we have a risk of violating rate limits on the first request of
      // the next stream, if it's part of this source.
      const spacing = getRequestSpacing(this.source, responseForSource);
      await sleep(spacing);
    }

    this.logger.info({
      msg: `Finished stream '${stream.name}'`,
    });
  }

  private async getSourceContext(): Promise<ConnectorContext> {
    const credentials = await this.credentials[this.source.name]?.get();

    return {
      credentials,
    };
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const source = this.source;
    const sourceContext = await this.getSourceContext();

    if (!source.headers) {
      return {};
    } else if (typeof source.headers === 'function') {
      return source.headers(sourceContext);
    } else {
      return source.headers;
    }
  }
}
