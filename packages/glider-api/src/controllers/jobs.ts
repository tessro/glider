import { APIGatewayProxyHandlerV2 as Handler } from 'aws-lambda';
import pino from 'pino';
import { lambdaRequestTracker, pinoLambdaDestination } from 'pino-lambda';

const withRequest = lambdaRequestTracker();
const destination = pinoLambdaDestination();
const logger = pino({}, destination);

export const list: Handler = async (event, context) => {
  withRequest(event, context);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  };
};
