import { APIGatewayProxyHandlerV2 as Handler } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import pino from 'pino';
import { lambdaRequestTracker, pinoLambdaDestination } from 'pino-lambda';

import { make400, make404 } from '../lambda';
import { SourceStore } from '../stores';
import { assertIsAWSError } from '../utils';

const withRequest = lambdaRequestTracker();
const destination = pinoLambdaDestination();
const logger = pino({}, destination);

const store = new SourceStore({
  client: new DynamoDB.DocumentClient({ apiVersion: '2012-11-05' }),
  tableName: 'paul-glider-Table',
});

export const list: Handler = async (event, context) => {
  withRequest(event, context);

  const sources = await store.getAll();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: sources }),
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

  // TODO(ptr): input validation

  const result = await store.create({
    provider: data.provider,
    credentials: data.credentials,
    options: data.options,
  });

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
};

export const get: Handler = async (event, context) => {
  withRequest(event, context);

  const id = event.pathParameters?.id;
  if (!id) {
    return make400({
      error_message: 'Expected source ID',
    });
  }

  const source = await store.get(id);
  if (!source) {
    return make404({
      error_message: 'Source not found',
    });
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source),
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
        error_message: 'Expected source ID',
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
        error_message: 'Source not found',
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
        error_message: 'Expected source ID',
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
