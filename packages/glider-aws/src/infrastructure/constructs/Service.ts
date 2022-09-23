import { join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aws_apigateway as apigateway,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { resolveScript } from '../utils.js';

import { Worker, WorkerProps } from './Worker.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface ServiceProps {
  dynamoDb?: {
    billingMode?: dynamodb.BillingMode;
    pointInTimeRecovery?: boolean;
  };
  worker?: Omit<WorkerProps, 'table'>;
}

interface AddRouteOptions {
  permissions?: {
    table?: 'r' | 'w' | 'rw';
    stateMachine?: 'start';
  };
}

interface Route {
  method: string;
  path: string;
  function: lambda.Function;
}

export class Service extends Construct {
  public readonly api: apigateway.RestApi;
  public readonly routes: Route[] = [];
  public readonly table: dynamodb.Table;
  public readonly worker: Worker;

  constructor(scope: Construct, id: string, props: ServiceProps = {}) {
    super(scope, id);

    this.table = new dynamodb.Table(this, 'Table', {
      billingMode:
        props.dynamoDb?.billingMode ?? dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: props.dynamoDb?.pointInTimeRecovery ?? true,
      timeToLiveAttribute: 'ttl',
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // TODO(ptr): state machine should talk to API
    this.worker = new Worker(this, 'Worker', {
      ...props.worker,
      table: this.table,
    });

    // The management API
    this.api = new apigateway.RestApi(this, 'Api');

    //
    // Sources
    //

    const sources = this.api.root.addResource('sources');
    this.addRoute(sources, 'GET', 'sources.list', {
      permissions: { table: 'r' },
    });
    this.addRoute(sources, 'POST', 'sources.create', {
      permissions: { table: 'rw' },
    });

    const sourceById = sources.addResource('{id}');
    this.addRoute(sourceById, 'GET', 'sources.get', {
      permissions: { table: 'r' },
    });
    this.addRoute(sourceById, 'PUT', 'sources.update', {
      permissions: { table: 'rw' },
    });
    this.addRoute(sourceById, 'DELETE', 'sources.destroy', {
      permissions: { table: 'rw' },
    });

    //
    // Destinations
    //

    const destinations = this.api.root.addResource('destinations');
    this.addRoute(destinations, 'GET', 'destinations.list', {
      permissions: { table: 'r' },
    });
    this.addRoute(destinations, 'POST', 'destinations.create', {
      permissions: { table: 'rw' },
    });

    const destinationById = destinations.addResource('{id}');
    this.addRoute(destinationById, 'GET', 'destinations.get', {
      permissions: { table: 'r' },
    });
    this.addRoute(destinationById, 'PUT', 'destinations.update', {
      permissions: { table: 'rw' },
    });
    this.addRoute(destinationById, 'DELETE', 'destinations.destroy', {
      permissions: { table: 'rw' },
    });

    //
    // Connections
    //

    const connections = this.api.root.addResource('connections');
    this.addRoute(connections, 'GET', 'connections.list', {
      permissions: { table: 'r' },
    });
    this.addRoute(connections, 'POST', 'connections.create', {
      permissions: { stateMachine: 'start', table: 'rw' },
    });

    const connectionById = connections.addResource('{id}');
    this.addRoute(connectionById, 'GET', 'connections.get', {
      permissions: { table: 'r' },
    });

    this.addRoute(connectionById, 'PUT', 'connections.update', {
      permissions: { table: 'rw' },
    });

    this.addRoute(connectionById, 'DELETE', 'connections.destroy', {
      permissions: { table: 'rw' },
    });

    const connectionAbort = connectionById.addResource('abort');
    this.addRoute(connectionAbort, 'POST', 'connections.abort', {
      permissions: { table: 'rw' },
    });

    const connectionRun = connectionById.addResource('run');
    this.addRoute(connectionRun, 'POST', 'connections.run', {
      permissions: { stateMachine: 'start', table: 'rw' },
    });

    //
    // Jobs
    //

    const jobs = this.api.root.addResource('jobs');
    this.addRoute(jobs, 'GET', 'jobs.list', {
      permissions: { table: 'r' },
    });
  }

  protected addRoute(
    resource: apigateway.Resource,
    method: string,
    path: string,
    options?: AddRouteOptions
  ): void {
    const environment = {
      DYNAMODB_TABLE_NAME: this.table.tableName,
      WORKER_STATE_MACHINE_ARN: this.worker.stateMachine.stateMachineArn,
    };

    const [entry, handler] = path.split('.');
    const pathId = resource.path
      .split('/')
      .map((part) => part.replace(/[{}]/g, '_'))
      .join('');
    const fn = new nodejs.NodejsFunction(this, `${method}${pathId}Lambda`, {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_16_X,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
      },
      entry: resolveScript(pathJoin(__dirname, `../../controllers/${entry}`)),
      handler,
      environment,
    });

    // Add this Lambda to the publicly accessible list of Lambdas
    this.routes.push({
      method,
      path,
      function: fn,
    });

    resource.addMethod(method, new apigateway.LambdaIntegration(fn), {
      authorizationType: apigateway.AuthorizationType.IAM,
    });

    switch (options?.permissions?.stateMachine) {
      case 'start':
        this.worker.stateMachine.grantStartExecution(fn);
        break;
      case undefined:
      // noop
    }

    switch (options?.permissions?.table) {
      case 'r':
        this.table.grantReadData(fn);
        break;
      case 'w':
        this.table.grantWriteData(fn);
        break;
      case 'rw':
        this.table.grantReadWriteData(fn);
        break;
      case undefined:
      // noop
    }
  }

  public grantApiAccess(grantee: iam.IPrincipal) {
    const { region, account } = this.api.env;

    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['execute-api:Invoke'],
      resourceArns: [
        `arn:aws:execute-api:${region}:${account}:${this.api.restApiId}/*`,
      ],
    });
  }
}
