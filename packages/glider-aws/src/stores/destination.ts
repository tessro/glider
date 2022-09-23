import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
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
  type: z.literal('destination'),
  id: z.string(),
  provider: z.string(),
  credentials: z.object({}).passthrough(),
  options: z.object({}).passthrough(),
  createdAt: z.number(),
});

type CreateDestinationInput = z.infer<typeof inputSchema>;
type UpdateDestinationInput = Omit<CreateDestinationInput, 'provider'>;

interface Destination {
  type: 'destination';
  id: string;
  provider: string;
  credentials: unknown;
  options: unknown;
  createdAt: Date;
}

interface Options {
  client: DynamoDBDocumentClient;
  tableName: string;
}

function format(item: unknown): Destination {
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

export class DestinationStore {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor(private options: Options) {
    this.client = options.client;
    this.tableName = options.tableName;
  }

  async get(id: string): Promise<Destination | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `destination#${id}`, sk: `metadata#${id}` },
      })
    );

    if (!result.Item) {
      return null;
    }

    return format(result.Item);
  }

  async getAll(): Promise<Destination[]> {
    const result = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: '#type = :type',
        ExpressionAttributeNames: {
          '#type': 'type',
        },
        ExpressionAttributeValues: {
          ':type': 'destination',
        },
      })
    );

    return result.Items?.map(format) ?? [];
  }

  async create(input: CreateDestinationInput): Promise<Destination> {
    const id = uuidv4();
    const now = Date.now();
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `destination#${id}`,
          sk: `metadata#${id}`,
          type: 'destination',
          id,
          provider: input.provider,
          credentials: input.credentials,
          options: input.options,
          createdAt: now,
        },
      })
    );

    return {
      type: 'destination',
      id,
      provider: input.provider,
      credentials: input.credentials,
      options: input.options,
      createdAt: new Date(now),
    };
  }

  async update(id: string, input: UpdateDestinationInput): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `destination#${id}`, sk: `metadata#${id}` },
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
    );
  }

  async delete(id: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: `destination#${id}`, sk: `metadata#${id}` },
      })
    );
  }
}
