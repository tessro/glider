// The context object Step Functions passes to Node.js Lambda invocations.
//
// Field comments are from the AWS docs.
//
// Source: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-context.html
export interface LambdaContext {
  // Returns the number of milliseconds left before the execution times out.
  getRemainingTimeInMillis(): number;

  // The name of the Lambda function.
  functionName: string;

  // The version of the function.
  functionVersion: string;

  // The Amazon Resource Name (ARN) that's used to invoke the function.
  // Indicates if the invoker specified a version number or alias.
  invokedFunctionArn: string;

  // The amount of memory that's allocated for the function.
  memoryLimitInMB: string;

  // The identifier of the invocation request.
  awsRequestId: string;

  // (mobile apps) Information about the Amazon Cognito identity that authorized
  // the request. [This is an empty object in our case.]
  identity: unknown;

  // (mobile apps) Client context that's provided to Lambda by the client
  // application. [This is an empty object in our case.]
  clientContext: unknown;

  // Set to false to send the response right away when the callback runs,
  // instead of waiting for the Node.js event loop to be empty. If this is
  // false, any outstanding events continue to run during the next invocation.
  callbackWaitsForEmptyEventLoop: boolean;
}
