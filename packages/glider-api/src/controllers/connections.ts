import { APIGatewayProxyHandlerV2 as Handler } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import pino from 'pino';
import { lambdaRequestTracker, pinoLambdaDestination } from 'pino-lambda';

import { make400, make404 } from '../lambda';
import { ConnectionStore } from '../stores/connection';
import { assertIsAWSError } from '../utils';

const withRequest = lambdaRequestTracker();
const destination = pinoLambdaDestination();
const logger = pino({}, destination);

const store = new ConnectionStore({
  client: new DynamoDB.DocumentClient({ apiVersion: '2012-11-05' }),
  tableName: 'paul-glider-Table',
});

export const list: Handler = async (event, context) => {
  withRequest(event, context);

  const connections = await store.getAll();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: connections }),
  };
};

export const create: Handler = async (event, context) => {
  withRequest(event, context);

  const result = await store.create({
    schedule: '* * * * *',
    sourceId: 'foo',
    destinationId: 'bar',
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
      error_message: 'Expected connection ID',
    });
  }

  const connection = await store.get(id);
  if (!connection) {
    return make404({
      error_message: 'Connection not found',
    });
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(connection),
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
        error_message: 'Expected connection ID',
      }),
    };
  }

  try {
    await store.update(id, {
      schedule: '*/60 * * * *',
    });
  } catch (err: unknown) {
    assertIsAWSError(err);

    if (err.code === 'ConditionalCheckFailedException') {
      logger.info({ err });

      return make404({
        error_message: 'Connection not found',
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
    body: JSON.stringify({ event }),
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
        error_message: 'Expected connection ID',
      }),
    };
  }

  await store.delete(id);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  };
};
