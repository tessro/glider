import type { DynamoDB } from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const inputSchema = z.object({
  provider: z.string(),
  credentials: z.object({}).passthrough(),
  options: z.object({}).passthrough(),
});

const recordSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  type: z.literal('source'),
  id: z.string(),
  provider: z.string(),
  credentials: z.object({}).passthrough(),
  options: z.object({}).passthrough(),
  createdAt: z.number(),
});

type CreateSourceInput = z.infer<typeof inputSchema>;
type UpdateSourceInput = Omit<CreateSourceInput, 'provider'>;

interface Source {
  type: 'source';
  id: string;
  provider: string;
  credentials: unknown;
  options: unknown;
  createdAt: Date;
}

interface Options {
  client: DynamoDB.DocumentClient;
  tableName: string;
}

function format(item: unknown): Source {
  const { type, id, provider, credentials, options, createdAt } =
    recordSchema.parse(item);

  return {
    type,
    id,
    provider,
    credentials,
    options,
    createdAt: new Date(createdAt),
  };
}

export class SourceStore {
  private client: DynamoDB.DocumentClient;
  private tableName: string;

  constructor(private options: Options) {
    this.client = options.client;
    this.tableName = options.tableName;
  }

  async get(id: string): Promise<Source | null> {
    const result = await this.client
      .get({
        TableName: this.tableName,
        Key: { pk: `source#${id}`, sk: `metadata#${id}` },
      })
      .promise();

    if (!result.Item) {
      return null;
    }

    return format(result.Item);
  }

  async getAll(): Promise<Source[]> {
    const result = await this.client
      .scan({
        TableName: this.tableName,
        FilterExpression: '#type = :type',
        ExpressionAttributeNames: {
          '#type': 'type',
        },
        ExpressionAttributeValues: {
          ':type': 'source',
        },
      })
      .promise();

    return result.Items?.map(format) ?? [];
  }

  async create(input: CreateSourceInput): Promise<Source> {
    const id = uuidv4();
    const now = Date.now();
    await this.client
      .put({
        TableName: this.tableName,
        Item: {
          pk: `source#${id}`,
          sk: `metadata#${id}`,
          type: 'source',
          id,
          provider: input.provider,
          credentials: input.credentials,
          options: input.options,
          createdAt: now,
        },
      })
      .promise();

    return {
      type: 'source',
      id,
      provider: input.provider,
      credentials: input.credentials,
      options: input.options,
      createdAt: new Date(now),
    };
  }

  async update(id: string, input: UpdateSourceInput): Promise<void> {
    await this.client
      .update({
        TableName: this.tableName,
        Key: { pk: `source#${id}`, sk: `metadata#${id}` },
        ConditionExpression: '#id = :id',
        UpdateExpression:
          'SET #credentials = :credentials, #options = :options',
        ExpressionAttributeNames: {
          '#id': 'id',
          '#credentials': 'credentials',
          '#options': 'options',
        },
        ExpressionAttributeValues: {
          ':id': id,
          ':credentials': input.credentials,
          ':options': input.options,
        },
      })
      .promise();
  }

  async delete(id: string): Promise<void> {
    await this.client
      .delete({
        TableName: this.tableName,
        Key: { pk: `source#${id}`, sk: `metadata#${id}` },
      })
      .promise();
  }
}
