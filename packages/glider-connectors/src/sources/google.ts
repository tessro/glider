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

abstract class GoogleStream implements Stream {
  // default for most Jira endpoints is 50
  pageSize = 100;

  constructor(readonly name: string) { }

  abstract seed(context: unknown): string;

  next(response: Response, _records: unknown[]) {
    const data = JSON.parse(response.body);
    if (!data.nextPageToken) {
      return null;
    }

    const url = new URL(response.url);
    url.searchParams.set('pageToken', data.nextPageToken);
    return url.toString();
  }

  transform(raw: string): unknown[] {
    const results = JSON.parse(raw);
    return results.items;
  }
}

class CalendarsStream extends GoogleStream {
  constructor() {
    super('calendars');
  }

  seed(): string {
    return `https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=${this.pageSize}`;
  }
}

interface EventsStreamContext {
  id: string;
}

interface EventsStreamOptions {
  start?: Date;
}

class EventsStream extends GoogleStream implements Stream<EventsStreamContext> {
  constructor(
    public parent: CalendarsStream,
    private readonly options: EventsStreamOptions
  ) {
    super('calendars');
  }

  seed(context: EventsStreamContext): string {
    // Google Calendar IDs can include symbols like '#'
    const calendarId = encodeURIComponent(context.id);
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?maxResults=${this.pageSize}`
    );

    if (this.options.start) {
      url.searchParams.set('timeMin', this.options.start.toISOString());
    }

    return url.toString();
  }
}

export class GoogleSource implements Source {
  readonly name = 'google';
  readonly streams: Stream[];

  private backoffCount = 0;

  private readonly logger = pino({
    base: {
      source: this.name,
    },
  });

  constructor(readonly options: Options) {
    const start = options.start ? new Date(options.start) : undefined;
    if (start) {
      this.logger.info({
        msg: `Initializing Google source with start time of ${start}`,
        start,
      });
    } else {
      this.logger.info({
        msg: `Initializing Google source with no start time`,
      });
    }

    const calendars = new CalendarsStream();

    this.streams = [calendars, new EventsStream(calendars, { start })];
  }

  headers(context: Context) {
    const { token } = context.credentials;
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  // Backoff returns the multiple of the default spacing that we should use. By
  // default, this is one, which means we use the default spacing. Each
  // sequential time we get asked to back off, this doubles, up to a max of 16x
  // slowdown. Once a request succeeds, we reset.
  get backoff(): number {
    return Math.min(2 ** this.backoffCount, 16);
  }

  requestSpacing(response: Response): number {
    if (response.statusCode == 429) {
      this.logger.warn({
        msg: `Received 429, backing off`,
        backoffCount: this.backoffCount,
        response: response.body,
      });
      this.backoffCount++;
    } else if (response.statusCode == 403) {
      const data = JSON.parse(response.body);
      const usageLimitError = data.error?.errors?.find(
        (e: { domain: string }) => e.domain === 'usageLimits'
      );
      if (usageLimitError) {
        this.logger.warn({
          msg: `Received 403: Calendar usage limits exceeded, backing off`,
          backoffCount: this.backoffCount,
          err: usageLimitError,
          response: data,
        });
        this.backoffCount++;
      }
    } else {
      // Otherwise, reset backoff count
      this.backoffCount = 0;
    }

    return 500 * this.backoff;
  }
}
