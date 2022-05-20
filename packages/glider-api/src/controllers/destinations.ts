import { APIGatewayProxyHandlerV2 as Handler } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import pino from 'pino';
import { lambdaRequestTracker, pinoLambdaDestination } from 'pino-lambda';

import { make400 } from '../lambda';
import { DestinationStore } from '../stores';

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

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  };
};

export const update: Handler = async (event, context) => {
  withRequest(event, context);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  };
};

export const destroy: Handler = async (event, context) => {
  withRequest(event, context);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  };
};
