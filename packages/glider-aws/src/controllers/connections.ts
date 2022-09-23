import { APIGatewayProxyHandler as Handler } from 'aws-lambda';
import { DynamoDB, StepFunctions } from 'aws-sdk';
import { pino } from 'pino';
import { lambdaRequestTracker, pinoLambdaDestination } from 'pino-lambda';

import { make400, make404 } from '../lambda.js';
import { ConnectionStore } from '../stores/connection.js';
import { assertIsAWSError } from '../utils.js';

const withRequest = lambdaRequestTracker();
const destination = pinoLambdaDestination();
const logger = pino({}, destination);

const sfn = new StepFunctions({ apiVersion: '2016-11-23' });
if (!process.env.WORKER_STATE_MACHINE_ARN) {
  throw new Error(
    `Missing required environment variable: $WORKER_STATE_MACHINE_ARN`
  );
}
const stateMachineArn = process.env.WORKER_STATE_MACHINE_ARN;

if (!process.env.DYNAMODB_TABLE_NAME) {
  throw new Error(
    `Missing required environment variable: $DYNAMODB_TABLE_NAME`
  );
}
const dynamoDbTableName = process.env.DYNAMODB_TABLE_NAME;

const store = new ConnectionStore({
  client: new DynamoDB.DocumentClient({ apiVersion: '2012-11-05' }),
  tableName: dynamoDbTableName,
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
    schedule: data.schedule,
    sourceId: data.sourceId,
    destinationId: data.destinationId,
  });

  // Invoke first run of the state machine
  const execution = await sfn
    .startExecution({
      stateMachineArn,
      input: JSON.stringify({
        connectionId: result.id,
        dynamoDbTableName,
        restart: {
          executionCount: 0,
          stateMachineArn,
        },
      }),
    })
    .promise();

  await store.setExecutionArn(result.id, execution.executionArn);

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
      schedule: data.schedule,
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

  // TODO(ptr): invoke state machine, if schedule is tighter

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

  // TODO(ptr): also cancel SFN execution?

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  };
};

export const abort: Handler = async (event, context) => {
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

  // TODO(ptr): also cancel SFN execution?

  // Clears `currentJobId`
  await store.abort(connection.id);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
    }),
  };
};

export const run: Handler = async (event, context) => {
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

  // Invoke run of the state machine
  const execution = await sfn
    .startExecution({
      stateMachineArn,
      input: JSON.stringify({
        connectionId: connection.id,
        dynamoDbTableName,
        restart: {
          executionCount: 0,
          stateMachineArn,
        },
      }),
    })
    .promise();

  await store.setExecutionArn(connection.id, execution.executionArn);

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      executionArn: execution.executionArn,
    }),
  };
};
