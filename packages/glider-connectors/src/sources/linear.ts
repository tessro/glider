import type { Context, Source, Stream } from '@balsahq/glider';
import { pino } from 'pino';

import type { Response } from '../types.js';

interface Options {
  start?: string;
}

// The complexity remaining at which we rate limit ourselves. This is intended
// to avoid situations where we're effectively rate limited because our query
// complexity exceeds our remaining complexity budget. (Since complexity is
// computed at request time, we don't know our exact expenditure in advance.)
//
// Our queries can be pretty involved and Linear's algorithm is moderately
// complicated, so let's just use 1% of our total limit as our threshold.
const MIN_COMPLEXITY = 2_000; // OAuth apps get 200k points/hour

abstract class LinearStream implements Stream {
  // default for most Linear endpoints is 50
  pageSize = 100;
  fields = ['id'];

  constructor(readonly name: string) { }

  next(response: Response) {
    const { data } = JSON.parse(response.body);
    const { endCursor, hasNextPage } = data[this.name].pageInfo;
    if (!hasNextPage) {
      return null;
    }

    return this.formatUrl(endCursor);
  }

  seed(): string {
    return this.formatUrl();
  }

  transform(raw: string): unknown[] {
    const results = JSON.parse(raw);
    return results.data[this.name].edges.map((e: { node: unknown }) => e.node);
  }

  protected formatUrl(cursor?: string): string {
    const cursorFragment = cursor ? `,after:"${cursor}"` : '';
    const fieldsFragment = this.fields.join(' ');
    return `https://api.linear.app/graphql?query={${this.name}(first:${this.pageSize}${cursorFragment}){edges{node{${fieldsFragment}}}pageInfo{hasNextPage endCursor}}}`;
  }
}

class IssuesStream extends LinearStream {
  fields = [
    'id',
    'identifier',
    'previousIdentifiers',
    'number',
    'title',
    'description',
    'parent{id}',
    'project{id}',
    'creator{id}',
    'assignee{id}',
    'state{id}',
    'estimate',
    'priority',
    'dueDate',
  ];

  constructor() {
    super('issues');
  }
}

class ProjectsStream extends LinearStream {
  fields = [
    'id',
    'name',
    'description',
    'creator{id}',
    'lead{id}',
    'state',
    'startDate',
    'targetDate',
  ];

  constructor() {
    super('projects');
  }
}

class TeamsStream extends LinearStream {
  fields = ['id', 'key', 'name'];

  constructor() {
    super('teams');
  }
}

class UsersStream extends LinearStream {
  fields = ['id', 'name', 'displayName', 'email'];

  constructor() {
    super('users');
  }
}

class WorkflowStatesStream extends LinearStream {
  fields = ['id', 'name', 'type', 'description'];

  constructor() {
    super('workflowStates');
  }
}

export class LinearSource implements Source {
  readonly name = 'linear';
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
        msg: `Initializing Linear source with start time of ${start}`,
        start,
      });
    } else {
      this.logger.info({
        msg: `Initializing Linear source with no start time`,
      });
    }

    this.streams = [
      new IssuesStream(),
      new ProjectsStream(),
      new TeamsStream(),
      new UsersStream(),
      new WorkflowStatesStream(),
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

    const rateLimit = {
      requests: {
        limit: getNumericHeader('x-ratelimit-requests-limit'),
        remaining: getNumericHeader('x-ratelimit-requests-remaining'),
        reset: getNumericHeader('x-ratelimit-requests-reset'),
      },
      complexity: {
        this: getNumericHeader('x-complexity'),
        limit: getNumericHeader('x-ratelimit-complexity-limit'),
        remaining: getNumericHeader('x-ratelimit-complexity-remaining'),
        reset: getNumericHeader('x-ratelimit-complexity-reset'),
      },
    };

    if (rateLimit.requests.remaining && rateLimit.requests.remaining <= 0) {
      if (!rateLimit.requests.reset) {
        this.logger.warn({
          msg: `Rate limited due to requests, but no reset time provided; waiting 5m`,
          rateLimit,
        });
        return 5 * 60 * 1000;
      }

      const reset = rateLimit.requests.reset * 1000;
      const now = Date.now();
      const spacing = +reset - now;
      this.logger.warn({
        msg: `Rate limited due to requests for ${spacing}ms`,
        spacing,
        rateLimit,
      });

      return spacing;
    }

    if (
      rateLimit.complexity.remaining &&
      rateLimit.complexity.remaining < MIN_COMPLEXITY
    ) {
      if (!rateLimit.complexity.reset) {
        this.logger.warn({
          msg: `Rate limited due to complexity, but no reset time provided; waiting 5m`,
          rateLimit,
        });
        return 5 * 60 * 1000;
      }

      const reset = rateLimit.complexity.reset * 1000;
      const now = Date.now();
      const spacing = +reset - now;
      this.logger.warn({
        msg: `Rate limited due to complexity for ${spacing}ms`,
        spacing,
        rateLimit,
      });

      // Pad by 5s to account for clock skew. We've seen GitHub continue to fail
      // us for a second or two after we wake up, claiming we woke up too
      // early. Other providers may do the same. Regardless, it's courteous
      // given that we just maxed out our allocation.
      return Math.max(spacing + 5000, 5000);
    }

    return 500;
  }
}
