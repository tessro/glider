import { URL } from 'url';

import type { Context, Source, Stream } from '@balsahq/glider';
import { pino } from 'pino';

import type { Response } from '../types.js';

interface Options {
  cloudId: string;
  orgs: string[];
  token: string;
  start?: string;
}

abstract class PagerDutyStream implements Stream {
  // default for most PagerDuty endpoints is 25
  pageSize = 100;

  constructor(readonly name: string) {}

  abstract seed(context: unknown): string;

  next(response: Response) {
    const data = JSON.parse(response.body);
    if (!data.more) {
      return null;
    }

    const url = new URL(response.url);
    url.searchParams.set('offset', data.offset + data.limit);
    return url.toString();
  }

  transform(raw: string): unknown[] {
    const results = JSON.parse(raw);
    return results[this.name];
  }
}

class OncallsStream extends PagerDutyStream {
  constructor() {
    super('oncalls');
  }

  seed(): string {
    const now = Date.now();
    // PagerDuty's oncall API will only search a maximum of "3 months".
    // We assume that means 90 days.
    // See: https://developer.pagerduty.com/api-reference/3a6b910f11050-list-all-of-the-on-calls
    const interval = 90 * 24 * 60 * 60 * 1000;
    const until = new Date(now + interval).toISOString();
    return `https://api.pagerduty.com/oncalls?limit=${this.pageSize}&until=${until}`;
  }
}

class UsersStream extends PagerDutyStream {
  constructor() {
    super('users');
  }

  seed(): string {
    return `https://api.pagerduty.com/users?limit=${this.pageSize}&include[]=contact_methods`;
  }
}

export class PagerDutySource implements Source {
  readonly name = 'pagerduty';
  readonly streams: Stream[];

  private readonly logger = pino({
    base: {
      source: this.name,
    },
  });

  constructor(options: Options) {
    const start = options.start ? new Date(options.start) : undefined;
    if (start) {
      this.logger.info({
        msg: `Initializing PagerDuty source with start time of ${start}`,
        start,
      });
    } else {
      this.logger.info({
        msg: `Initializing PagerDuty source with no start time`,
      });
    }

    this.streams = [new OncallsStream(), new UsersStream()];
  }

  headers(context: Context) {
    const { token } = context.credentials;
    return {
      Accept: 'application/vnd.pagerduty+json;version=2',
      Authorization: `Token token=${token}`,
    };
  }

  requestSpacing(response: Response): number {
    if (response.statusCode == 429) {
      // PagerDuty recommends backing off for 30s after a 429
      //
      // See: https://developer.pagerduty.com/docs/ZG9jOjExMDI5NTUz-rate-limiting
      return 30 * 1000;
    }

    return 500;
  }
}
