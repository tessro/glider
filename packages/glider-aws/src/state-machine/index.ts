import { DynamoDB, StepFunctions } from 'aws-sdk';
import { parseExpression } from 'cron-parser';
import pino from 'pino';
import { lambdaRequestTracker, pinoLambdaDestination } from 'pino-lambda';

import { makeStores } from '../stores';

import type { LambdaContext } from './LambdaContext';

const withRequest = lambdaRequestTracker();
const destination = pinoLambdaDestination();
const logger = pino({}, destination);

interface Input {
  connectionId: string;
  dynamoDbTableName: string;
  restart: {
    stateMachineArn: string;
    executionCount: number;
  };
}

// Command for re-invoking the state machine after completion
interface LoopCommand {
  action: 'LOOP';
}

// Command for invoking the Glider runner
interface RunCommand {
  action: 'RUN';

  // TODO(ptr): do we need this?
  jobId: string;
  // Arguments to pass to the runner
  runnerArgs: string[];
}

// Shared pattern for telling the state machine to terminate
interface TerminateCommand {
  action: 'TERMINATE';
}

// Shared pattern for telling the state machine to wait
interface WaitCommand {
  action: 'WAIT';
  // The `Wait` step reads this to figure out how long to sleep for
  waitUntil: string;
}

// Strong typing for Step Function Lambdas. All functions receive the same
// input, only their output varies.
type Handler<O = unknown> = (
  event: Input,
  context: LambdaContext
) => Promise<O>;

type BeforeSyncOutput = RunCommand | TerminateCommand;

export const beforeSync: Handler<BeforeSyncOutput> = async (event, context) => {
  withRequest(event, context);

  const db = makeStores({
    client: new DynamoDB.DocumentClient({ apiVersion: '2012-11-05' }),
    tableName: event.dynamoDbTableName,
  });

  // Check if connection has another job running.
  // If yes, don't return a job ID. The state machine will terminate.
  // If not, generate a Job ID and mark connection as running.
  const jobId = await db.connections.reserve(event.connectionId);
  if (!jobId) {
    logger.warn({
      msg: `Couldn't reserve job ID for connection '${event.connectionId}'. This either means another job is running, or something got stuck.`,
      event,
    });
    return { action: 'TERMINATE' };
  }

  const connection = await db.connections.get(event.connectionId);
  if (!connection) {
    throw new Error(`Couldn't find connection '${event.connectionId}'`);
  }

  const source = await db.sources.get(connection.sourceId);
  if (!source) {
    throw new Error(`Couldn't find source '${connection.sourceId}'`);
  }

  const destination = await db.destinations.get(connection.destinationId);
  if (!destination) {
    throw new Error(`Couldn't find destination '${connection.destinationId}'`);
  }

  return {
    action: 'RUN',
    jobId,
    runnerArgs: [
      '--source',
      source.provider,
      '--source-credentials',
      JSON.stringify(source.credentials ?? {}),
      '--source-options',
      JSON.stringify(source.options ?? {}),
      '--destination',
      destination.provider,
      '--destination-credentials',
      JSON.stringify(destination.credentials ?? {}),
      '--destination-options',
      JSON.stringify(destination.options ?? {}),
    ],
  };
};

export const afterSync: Handler<WaitCommand> = async (event, context) => {
  withRequest(event, context);

  const db = makeStores({
    client: new DynamoDB.DocumentClient({ apiVersion: '2012-11-05' }),
    tableName: event.dynamoDbTableName,
  });

  await db.connections.finish(event.connectionId);

  const connection = await db.connections.get(event.connectionId);
  if (!connection) {
    throw new Error(`no connection with id ${event.connectionId}`);
  }

  const schedule = parseExpression(connection.schedule);
  const waitUntil = schedule.next().toISOString();

  logger.info({
    msg: `Sleeping until ${waitUntil}`,
    schedule: connection.schedule,
    waitUntil,
  });

  return {
    action: 'WAIT',
    waitUntil,
  };
};

type AfterSleepOutput = LoopCommand | TerminateCommand | WaitCommand;

export const afterSleep: Handler<AfterSleepOutput> = async (event, context) => {
  withRequest(event, context);

  const db = makeStores({
    client: new DynamoDB.DocumentClient({ apiVersion: '2012-11-05' }),
    tableName: event.dynamoDbTableName,
  });

  const connection = await db.connections.get(event.connectionId);
  if (!connection || connection.currentJobId) {
    // Terminate if the connection is missing (presumed deleted) or has a
    // `currentJobId`, indicating another state machine has taken over and is
    // currently running.
    return {
      action: 'TERMINATE',
    };
  }

  const schedule = parseExpression(connection.schedule, {
    currentDate: connection.lastRanAt,
  });
  const next = schedule.next();
  const remainingTime = next.getTime() - Date.now();
  if (remainingTime < 0) {
    return {
      action: 'LOOP',
    };
  } else {
    return {
      action: 'WAIT',
      waitUntil: next.toISOString(),
    };
  }
};

export const invokeSelf: Handler = async (event, context) => {
  withRequest(event, context);

  logger.info({
    msg: 'Invoking another execution of the state machine',
    connectionId: event.connectionId,
    stateMachineArn: event.restart.stateMachineArn,
  });

  const db = makeStores({
    client: new DynamoDB.DocumentClient({ apiVersion: '2012-11-05' }),
    tableName: event.dynamoDbTableName,
  });

  const sfn = new StepFunctions({
    apiVersion: '2016-11-23',
  });

  const execution = await sfn
    .startExecution({
      stateMachineArn: event.restart.stateMachineArn,
      input: JSON.stringify({
        connectionId: event.connectionId,
        dynamoDbTableName: event.dynamoDbTableName,
        restart: {
          executionCount: event.restart.executionCount + 1,
          stateMachineArn: event.restart.stateMachineArn,
        },
      }),
    })
    .promise();

  logger.info({
    msg: `Successfully invoked another execution for connection '${event.connectionId}'`,
    connectionId: event.connectionId,
    execution: {
      arn: execution.executionArn,
      startDate: execution.startDate,
    },
    stateMachineArn: event.restart.stateMachineArn,
  });

  await db.connections.setExecutionArn(
    event.connectionId,
    execution.executionArn
  );
};
