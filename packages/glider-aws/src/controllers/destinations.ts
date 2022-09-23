import { APIGatewayProxyHandler as Handler } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import { pino } from 'pino';
import { lambdaRequestTracker, pinoLambdaDestination } from 'pino-lambda';

import { make400, make404 } from '../lambda.js';
import { DestinationStore } from '../stores.js';
import { assertIsAWSError } from '../utils.js';

const withRequest = lambdaRequestTracker();
const destination = pinoLambdaDestination();
const logger = pino({}, destination);

if (!process.env.DYNAMODB_TABLE_NAME) {
  throw new Error(`Missing required environment variable $DYNAMODB_TABLE_NAME`);
}

const store = new DestinationStore({
  client: new DynamoDB.DocumentClient({ apiVersion: '2012-11-05' }),
  tableName: process.env.DYNAMODB_TABLE_NAME,
});

export const list: Handler = async (event, context) => {
  withRequest(event, context);

  const destinations = await store.getAll();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: destinations }),
  };
};

export const create: Handler = async (event, context) => {
  withRequest(event, context);

  if (!event.body) {
    return make400({
      error_message: 'Expected JSON payload',
    });
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (e) {
    return make400({
      error_message: 'Invalid JSON',
    });
  }

  const result = await store.create({
    provider: data.provider,
    credentials: data.credentials,
    options: data.options,
  });

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result }),
  };
};

export const get: Handler = async (event, context) => {
  withRequest(event, context);

  const id = event.pathParameters?.id;
  if (!id) {
    return make400({
      error_message: 'Expected destination ID',
    });
  }

  const destination = await store.get(id);
  if (!destination) {
    return make404({
      error_message: 'Destination not found',
    });
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(destination),
  };
};

export const update: Handler = async (event, context) => {
  withRequest(event, context);

  const id = event.pathParameters?.id;
  if (!id) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'INVALID_INPUT',
        error_message: 'Expected destination ID',
      }),
    };
  }

  if (!event.body) {
    return make400({
      error_message: 'Expected JSON payload',
    });
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (e) {
    return make400({
      error_message: 'Invalid JSON',
    });
  }

  // TODO(ptr): input validation

  try {
    await store.update(id, {
      credentials: data.credentials,
      options: data.options,
    });
  } catch (err: unknown) {
    assertIsAWSError(err);

    if (err.code === 'ConditionalCheckFailedException') {
      logger.info({ err });

      return make404({
        error_message: 'Destination not found',
      });
    } else {
      logger.error({ err });

      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'INTERNAL_SERVER_ERROR',
          error_message: 'Internal server error',
        }),
      };
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};

export const destroy: Handler = async (event, context) => {
  withRequest(event, context);

  const id = event.pathParameters?.id;
  if (!id) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'INVALID_INPUT',
        error_message: 'Expected destination ID',
      }),
    };
  }

  await store.delete(id);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
