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

abstract class SlackStream implements Stream {
  // Slack recommends 100-200; the limit is 1000
  pageSize = 200;

  constructor(readonly name: string) {}

  abstract seed(context: unknown): string;

  next(response: Response, _records: unknown[]) {
    const data = JSON.parse(response.body);
    if (!data.response_metadata?.next_cursor) {
      return null;
    }

    const url = new URL(response.url);
    url.searchParams.set('cursor', data.response_metadata.next_cursor);
    return url.toString();
  }

  transform(raw: string): unknown[] {
    const results = JSON.parse(raw);
    return results.values;
  }
}

type ConversationType = 'public_channel' | 'private_channel' | 'mpim' | 'im';

interface ConversationRecord {
  id: string;
}

interface ConversationsStreamOptions {
  excludeArchived?: boolean;
  types?: ConversationType[];
  start?: Date;
}

class ConversationsStream extends SlackStream {
  private excludeArchived: boolean;
  private types?: ConversationType[];

  constructor(options: ConversationsStreamOptions) {
    super('conversations');

    this.excludeArchived = options.excludeArchived ?? false;
    this.types = options.types;
  }

  seed(): string {
    const url = new URL(
      `https://slack.com/api/conversations.list?limit=${this.pageSize}`
    );

    if (this.excludeArchived) {
      url.searchParams.set('exclude_archived', 'true');
    }

    if (this.types) {
      url.searchParams.set('types', this.types.join(','));
    }

    return url.toString();
  }

  transform(raw: string) {
    const data = JSON.parse(raw);
    return data.channels;
  }
}

interface MessagesStreamOptions {
  start?: Date;
}

class MessagesStream extends SlackStream {
  private readonly start?: Date;

  constructor(
    readonly parent: ConversationsStream,
    options: MessagesStreamOptions
  ) {
    super('messages');

    this.start = options.start;
  }

  seed(context: ConversationRecord): string {
    const url = new URL(
      `https://slack.com/api/conversations.history?channel=${context.id}&limit=${this.pageSize}`
    );

    if (this.start) {
      const ts = this.start.getTime() / 1000;
      url.searchParams.set('oldest', ts.toString());
    }

    return url.toString();
  }

  transform(raw: string) {
    const data = JSON.parse(raw);

    // Ideally we wouldn't make these calls in the first place,
    // but that's a bit trickier to implement.
    if (data.error === 'not_in_channel') {
      return [];
    }

    return data.messages;
  }
}

class UsersStream extends SlackStream {
  constructor() {
    super('users');
  }

  seed(): string {
    return `https://slack.com/api/users.list?limit=${this.pageSize}`;
  }

  transform(raw: string) {
    const data = JSON.parse(raw);
    return data.members;
  }
}

export class SlackSource implements Source {
  readonly name = 'slack';
  readonly streams: Stream[];

  private readonly logger = pino({
    base: {
      source: this.name,
    },
  });

  constructor(readonly options: Options) {
    const start = options.start ? new Date(options.start) : undefined;
    if (start) {
      this.logger.info({
        msg: `Initializing Slack source with start time of ${start}`,
        start,
      });
    } else {
      this.logger.info({
        msg: `Initializing Slack source with no start time`,
      });
    }

    const conversations = new ConversationsStream({});
    this.streams = [
      conversations,
      new MessagesStream(conversations, { start }),
      new UsersStream(),
    ];
  }

  headers(context: Context) {
    const { token } = context.credentials;
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

    const retryAfter = getNumericHeader('retry-after');

    if (retryAfter) {
      const spacing = retryAfter * 1000;
      this.logger.warn({
        msg: `Rate limited for ${spacing}ms`,
        spacing,
        headers: {
          'retry-after': response.headers['retry-after'],
        },
      });

      return spacing;
    }

    return 500;
  }
}
