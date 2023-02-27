import {
  Context as ConnectorContext,
  Destination,
  DestinationContext,
  Request,
  Source,
  Stream,
  CredentialsProvider,
} from '@balsahq/glider';
import { Response } from '@balsahq/glider-connectors';
import got from 'got';
import { pino, Logger } from 'pino';

import { sleep } from './utils.js';

interface JobOptions {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  credentials: Record<string, any>;
  source: Source;
  sourceOptions: unknown;
  destination: Destination;
  destinationOptions: unknown;
  logger?: Logger;
}

const MAX_ATTEMPTS = 3;

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

function toRequest(input: string | Request): Request {
  if (typeof input === 'string') {
    return { url: input, method: 'GET', body: undefined };
  } else {
    return input;
  }
}

function getSeed(stream: Stream, context: unknown): Request {
  if (typeof stream.seed === 'function') {
    return toRequest(stream.seed(context));
  } else {
    return toRequest(stream.seed);
  }
}

export class Job {
  readonly id: string;

  private readonly source: Source;
  private readonly destination: Destination;
  private readonly destinationContext: DestinationContext;

  private readonly credentials: Record<string, CredentialsProvider>;
  private readonly logger: Logger;

  constructor(private readonly options: JobOptions) {
    this.id = options.id;
    this.source = options.source;
    this.destination = options.destination;
    this.destinationContext = {
      jobId: this.id,
      sourceOptions: options.sourceOptions,
      destinationOptions: options.destinationOptions,
    };
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
        this.source.name,
        stream.name,
        records,
        now,
        this.destinationContext
      );
    });
  }

  async readStream(
    stream: Stream,
    context: unknown,
    callback: (records: unknown[]) => Promise<void>
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
    callback: (records: unknown[]) => Promise<void>
  ): Promise<void> {
    const headers = await this.getHeaders();
    const transform = stream.transform?.bind(stream) ?? defaultTransform;

    this.logger.info({
      msg: `Starting stream '${stream.name}'`,
    });

    let req = getSeed(stream, context);
    let attempts = 0;
    while (req) {
      this.logger.info({ msg: `Fetching '${req.url}'`, req });
      const response = await got(req.url, {
        method: req.method,
        body: req.body,
        headers: { ...headers, ...req.headers },
        throwHttpErrors: false,
      });

      const responseForSource = {
        url: req.url,
        body: response.body,
        headers: response.headers,
        statusCode: response.statusCode,
      };

      if (response.statusCode >= 200 && response.statusCode < 300) {
        const records = transform(response.body, context);
        await callback(records);
        this.logger.info({
          msg: `Successfully fetched ${req.url}`,
          req,
          records: records.length,
        });

        if (!stream.next) break;

        const nextReq = stream.next(responseForSource, records, context);
        if (!nextReq) break;

        attempts = 0;
        req = toRequest(nextReq);
      } else {
        attempts++;
        this.logger.warn({
          msg: `Received ${response.statusCode} while fetching '${req.url}'`,
          req,
          headers,
          statusCode: response.statusCode,
          response: response.body,
        });
        if (attempts > MAX_ATTEMPTS) {
          this.logger.error({
            msg: `Exceeded maximum attempts while fetching '${req.url}', aborting`,
            req,
            headers,
            statusCode: response.statusCode,
            response: response.body,
            attempts,
            maxAttempts: MAX_ATTEMPTS,
          });
          throw new Error(
            `Exceeded maximum attempts while fetching '${req.url}', aborting`
          );
        }
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
