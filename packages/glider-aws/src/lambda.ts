import {
  APIGatewayProxyResultV2 as Response,
} from 'aws-lambda';

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
