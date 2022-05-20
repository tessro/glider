import type { DynamoDB } from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { assertIsAWSError } from '../utils';

const inputSchema = z.object({
  sourceId: z.string(),
  destinationId: z.string(),
  schedule: z.string(),
});

const recordSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  type: z.literal('connection'),
  id: z.string(),
  sourceId: z.string(),
  destinationId: z.string(),
  schedule: z.string(),
  currentJobId: z.string().optional(),
  lastRanAt: z.number().optional(),
  createdAt: z.number(),
});

type CreateConnectionInput = z.infer<typeof inputSchema>;
type UpdateConnectionInput = Pick<CreateConnectionInput, 'schedule'>;

export interface Connection {
  type: 'connection';
  id: string;
  sourceId: string;
  destinationId: string;
  schedule: string;
  currentJobId: string | null;
  lastRanAt?: Date;
  createdAt: Date;
}

interface Options {
  client: DynamoDB.DocumentClient;
  tableName: string;
}

function format(item: unknown): Connection {
  const {
    type,
    id,
    sourceId,
    destinationId,
    schedule,
    currentJobId,
    createdAt,
    lastRanAt,
  } = recordSchema.parse(item);

  return {
    type,
    id,
    sourceId,
    destinationId,
    schedule,
    currentJobId: currentJobId ?? null,
    lastRanAt: lastRanAt ? new Date(lastRanAt) : undefined,
    createdAt: new Date(createdAt),
  };
}

export class ConnectionStore {
  private client: DynamoDB.DocumentClient;
  private tableName: string;

  constructor(private options: Options) {
    this.client = options.client;
    this.tableName = options.tableName;
  }

  async get(id: string): Promise<Connection | null> {
    const result = await this.client
      .get({
        TableName: this.tableName,
        Key: { pk: `connection#${id}`, sk: `metadata#${id}` },
      })
      .promise();

    if (!result.Item) {
      return null;
    }

    return format(result.Item);
  }

  async getAll(): Promise<Connection[]> {
    const result = await this.client
      .scan({
        TableName: this.tableName,
        FilterExpression: '#type = :type',
        ExpressionAttributeNames: {
          '#type': 'type',
        },
        ExpressionAttributeValues: {
          ':type': 'connection',
        },
      })
      .promise();

    return result.Items?.map(format) ?? [];
  }

  async create(input: CreateConnectionInput): Promise<Connection> {
    const id = uuidv4();
    const now = Date.now();
    await this.client
      .put({
        TableName: this.tableName,
        Item: {
          pk: `connection#${id}`,
          sk: `metadata#${id}`,
          type: 'connection',
          id,
          sourceId: input.sourceId,
          destinationId: input.destinationId,
          schedule: input.schedule,
          createdAt: now,
        },
      })
      .promise();

    return {
      type: 'connection',
      id,
      sourceId: input.sourceId,
      destinationId: input.destinationId,
      schedule: input.schedule,
      currentJobId: null,
      createdAt: new Date(now),
    };
  }

  async update(id: string, input: UpdateConnectionInput): Promise<void> {
    await this.client
      .update({
        TableName: this.tableName,
        Key: { pk: `connection#${id}`, sk: `metadata#${id}` },
        ConditionExpression: '#id = :id',
        UpdateExpression: 'SET #schedule = :schedule',
        ExpressionAttributeNames: {
          '#id': 'id',
          '#schedule': 'schedule',
        },
        ExpressionAttributeValues: {
          ':id': id,
          ':schedule': input.schedule,
        },
      })
      .promise();
  }

  async reserve(id: string): Promise<string | null> {
    const jobId = uuidv4();
    try {
      await this.client
        .update({
          TableName: this.tableName,
          Key: { pk: `connection#${id}`, sk: `metadata#${id}` },
          ConditionExpression:
            'attribute_exists(pk) AND attribute_not_exists(#currentJobId)',
          UpdateExpression: 'SET #currentJobId = :currentJobId',
          ExpressionAttributeNames: {
            '#currentJobId': 'currentJobId',
          },
          ExpressionAttributeValues: {
            ':currentJobId': jobId,
          },
        })
        .promise();
    } catch (e) {
      assertIsAWSError(e);
      // If we get a conditional check failure, that means either the item is
      // missing or it had a `currentJobId` value.
      if (e.code === 'ConditionalCheckFailedException') {
        return null;
      } else {
        throw e;
      }
    }

    return jobId;
  }

  async finish(id: string): Promise<boolean> {
    await this.client
      .update({
        TableName: this.tableName,
        Key: { pk: `connection#${id}`, sk: `metadata#${id}` },
        ConditionExpression: 'attribute_exists(#currentJobId)',
        UpdateExpression: 'REMOVE #currentJobId SET #lastRanAt = :lastRanAt',
        ExpressionAttributeNames: {
          '#currentJobId': 'currentJobId',
          '#lastRanAt': 'lastRanAt',
        },
        ExpressionAttributeValues: {
          ':lastRanAt': Date.now(),
        },
      })
      .promise();

    return true;
  }

  async abort(id: string): Promise<boolean> {
    await this.client
      .update({
        TableName: this.tableName,
        Key: { pk: `connection#${id}`, sk: `metadata#${id}` },
        ConditionExpression: 'attribute_exists(#currentJobId)',
        UpdateExpression: 'REMOVE #currentJobId',
        ExpressionAttributeNames: {
          '#currentJobId': 'currentJobId',
        },
      })
      .promise();

    return true;
  }

  async delete(id: string): Promise<void> {
    await this.client
      .delete({
        TableName: this.tableName,
        Key: { pk: `connection#${id}`, sk: `metadata#${id}` },
      })
      .promise();
  }
}
