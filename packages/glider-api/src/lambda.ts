import {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2 as Response,
} from 'aws-lambda';
import { SQS } from 'aws-sdk';

const queueUrl =
  'https://sqs.us-west-2.amazonaws.com/365914543885/paul-glider-ExtractQueue';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sqs = new SQS({ apiVersion: '2012-11-05' });
  const result = await sqs
    .sendMessage({
      QueueUrl: queueUrl,
      MessageBody: 'hi!',
    })
    .promise();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain' },
    body: `Hello, World! Your request was received at ${event.requestContext.time}. ${result.MessageId}`,
  };
};

function makeResponse(statusCode: number, props: object): Response {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(props),
  };
}

export function make200(props: object): Response {
  return makeResponse(200, props);
}

export function make201(props: object): Response {
  return makeResponse(201, props);
}

export function make400(props: object): Response {
  return makeResponse(400, {
    error: 'INVALID_INPUT',
    ...props,
  });
}

export function make404(props: object): Response {
  return makeResponse(404, {
    error: 'NOT_FOUND',
    ...props,
  });
}
