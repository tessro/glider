import { URL } from 'url';

import type { Context, Source, Stream } from 'glider';
import pino from 'pino';

import type { Response } from '../types';

interface Options {
  cloudId: string;
  orgs: string[];
  token: string;
  start?: string;
}

abstract class JiraStream implements Stream {
  // default for most Jira endpoints is 50
  pageSize = 100;

  constructor(readonly name: string) {}

  abstract seed(context: unknown): string;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next(response: Response, records: unknown[]) {
    const data = JSON.parse(response.body);
    if (data.isLast) {
      return null;
    } else if (data.nextPage) {
      return data.nextPage;
    }

    const url = new URL(response.url);
    url.searchParams.set('startAt', data.startAt + data.maxResults);
    return url.toString();
  }

  transform(raw: string): unknown[] {
    const results = JSON.parse(raw);
    return results.values;
  }
}

interface ProjectsStreamOptions {
  cloudId: string;
  start?: Date;
}

class ProjectsStream extends JiraStream {
  private start?: Date;
  private cloudId: string;

  constructor(options: ProjectsStreamOptions) {
    super('projects');

    this.start = options.start;
    this.cloudId = options.cloudId;
  }

  seed(): string {
    return `https://api.atlassian.com/ex/jira/${this.cloudId}/rest/api/3/project/search?maxResults=${this.pageSize}`;
  }
}

export class JiraSource implements Source {
  readonly name = 'jira';
  readonly streams: Stream[];

  private readonly logger = pino({
    base: {
      source: this.name,
    },
  });

  constructor(private readonly options: Options) {
    const start = options.start ? new Date(options.start) : undefined;
    if (start) {
      this.logger.info({
        msg: `Initializing Jira source with start time of ${start}`,
        start,
      });
    } else {
      this.logger.info({
        msg: `Initializing Jira source with no start time`,
      });
    }

    this.streams = [
      new ProjectsStream({
        cloudId: options.cloudId,
        start,
      }),
    ];
  }

  headers(context: Context) {
    const token = context.credentials;
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  requestSpacing(response: Response): number {
    function getNumericHeader(key: string): number | null {
      const valueOrValues = response.headers[key];
      if (Array.isArray(valueOrValues)) {
        return parseInt(valueOrValues[0]);
      } else if (valueOrValues) {
        return parseInt(valueOrValues);
      } else {
        return null;
      }
    }

    function getDateHeader(key: string): Date | null {
      const valueOrValues = response.headers[key];
      if (Array.isArray(valueOrValues)) {
        return new Date(valueOrValues[0]);
      } else if (valueOrValues) {
        return new Date(valueOrValues);
      } else {
        return null;
      }
    }

    const retryAfter = getNumericHeader('retry-after');
    const rateLimitReset = getDateHeader('x-ratelimit-reset');

    if (retryAfter) {
      const spacing = retryAfter * 1000;
      this.logger.warn({
        msg: `Rate limited for ${spacing}ms`,
        spacing,
        headers: {
          'retry-after': response.headers['retry-after'],
          'x-ratelimit-reset': response.headers['x-ratelimit-reset'],
        },
      });

      return spacing;
    }

    if (rateLimitReset) {
      const now = Date.now();
      const spacing = +rateLimitReset - now;
      this.logger.warn({
        msg: `Rate limited for ${spacing}ms`,
        spacing,
        headers: {
          'retry-after': response.headers['retry-after'],
          'x-ratelimit-reset': response.headers['x-ratelimit-reset'],
        },
      });

      // Pad by 5s to account for clock skew. We've seen GitHub continue to fail
      // us for a second or two after we wake up, claiming we woke up too early.
      return Math.max(spacing + 5000, 5000);
    }

    return 500;
  }
}
