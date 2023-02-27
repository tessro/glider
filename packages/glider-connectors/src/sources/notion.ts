import { URL } from 'url';

import type { Context, Request, Source, Stream } from '@balsahq/glider';
import { pino } from 'pino';

import type { Response } from '../types.js';

interface Options {
  cloudId: string;
  orgs: string[];
  token: string;
  start?: string;
}

abstract class NotionStream implements Stream {
  // Notion's max page size is 100
  pageSize = 100;

  constructor(readonly name: string) { }

  abstract seed(context: unknown): string | Request;

  next(response: Response, _records: unknown[]): string | Request | null {
    const data = JSON.parse(response.body);
    if (!data.has_more) {
      return null;
    }

    const url = new URL(response.url);
    url.searchParams.set('start_cursor', data.next_cursor);
    return url.toString();
  }

  transform(raw: string): unknown[] {
    const data = JSON.parse(raw);
    return data.results;
  }
}

class UsersStream extends NotionStream {
  constructor() {
    super('users');
  }

  override seed(): string {
    return `https://api.notion.com/v1/users?page_size=${this.pageSize}`;
  }
}

interface IncrementalNotionStreamOptions {
  start?: string;
}

class IncrementalNotionStream extends NotionStream {
  constructor(
    readonly name: string,
    private readonly objectType: 'page' | 'database',
    protected readonly options: IncrementalNotionStreamOptions
  ) {
    super(name);
  }

  override seed(): Request {
    return {
      url: 'https://api.notion.com/v1/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sort: {
          direction: 'ascending',
          timestamp: 'last_edited_time',
        },
        filter: {
          property: 'object',
          value: this.objectType,
        },
        start_cursor: this.options.start,
        page_size: this.pageSize,
      }),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override next(response: Response, _records: unknown[]) {
    const data = JSON.parse(response.body);
    if (!data.has_more) {
      return null;
    }

    return {
      url: 'https://api.notion.com/v1/search',
      method: 'POST' as const,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sort: {
          direction: 'ascending',
          timestamp: 'last_edited_time',
        },
        filter: {
          property: 'object',
          value: 'page',
        },
        start_cursor: data.next_cursor,
        page_size: this.pageSize,
      }),
    };
  }
}

class DatabasesStream extends IncrementalNotionStream {
  constructor(readonly options: IncrementalNotionStreamOptions) {
    super('databases', 'database', options);
  }
}

class PagesStream extends IncrementalNotionStream {
  constructor(readonly options: IncrementalNotionStreamOptions) {
    super('pages', 'page', options);
  }
}

interface PagesStreamContext {
  id: string;
}

class BlocksStream extends NotionStream implements Stream<PagesStreamContext> {
  private queue: string[] = [];

  constructor(public readonly parent: PagesStream) {
    super('blocks');
  }

  override seed(context: PagesStreamContext) {
    return `https://api.notion.com/v1/blocks/${context.id}/children?page_size=${this.pageSize}`;
  }

  // In addition to paginating over blocks, we also perform a tree traversal,
  // fetching all child blocks. This is done using breadth-first search
  // strategy, which emits all blocks at one level of depth before emitting
  // the next layer. As a result, blocks are emitted "out of order" from a
  // human perspective. (They don't match the order they appear on a page.)
  // Reconstructing the natural order is left to later transform stages. Doing
  // it here would require a lot more flow control sources currently have.
  override next(response: Response, records: any[]): string | Request | null {
    for (const record of records) {
      if (record.has_children) {
        this.queue.push(record.id);
      }
    }

    const data = JSON.parse(response.body);
    if (data.has_more) {
      const url = new URL(response.url);
      url.searchParams.set('start_cursor', data.next_cursor);
      return url.toString();
    }

    const next = this.queue.shift();
    if (next) {
      return `https://api.notion.com/v1/blocks/${next}/children?page_size=${this.pageSize}`;
    } else {
      return null;
    }
  }

  override transform(raw: string): unknown[] {
    const results = super.transform(raw);

    // Filter out pages and databases, since we emit them elsewhere
    return results.filter(
      (r: any) => !['child_page', 'child_database'].includes(r.type)
    );
  }
}

export class NotionSource implements Source {
  readonly name = 'notion';
  readonly streams: Stream[];

  private readonly logger = pino({
    base: {
      source: this.name,
    },
  });

  constructor(readonly options: Options) {
    const { start } = options;
    if (start) {
      this.logger.info({
        msg: `Initializing Notion source with start cursor of ${start}`,
        start,
      });
    } else {
      this.logger.info({
        msg: `Initializing Notion source with no start cursor`,
      });
    }

    const pages = new PagesStream({ start });
    this.streams = [
      pages,
      new DatabasesStream({ start }),
      new BlocksStream(pages),
      new UsersStream(),
    ];
  }

  headers(context: Context) {
    const { token } = context.credentials;
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
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

    if (response.statusCode === 429) {
      const retryAfter = getNumericHeader('retry-after');
      this.logger.warn({
        msg: `Received 429, backing off`,
        retryAfter,
        response: response.body,
      });

      if (retryAfter) {
        return retryAfter * 1000;
      } else {
        // Wait an arbitrary 5s if the `Retry-After` header is missing
        return 5000;
      }
    }

    // Notion allows an average of 3 requests per second, so we could
    // potentially go faster, but 500ms is fast enough in most cases.
    return 500;
  }
}
