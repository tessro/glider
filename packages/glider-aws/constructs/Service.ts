import { Api } from '@serverless-stack/resources';
import {
  Stack,
  aws_dynamodb as dynamodb,
  aws_ecs as ecs,
  aws_s3 as s3,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { Worker } from './Worker';

interface ServiceProps {
  dynamoDb?: {
    billingMode?: dynamodb.BillingMode;
  };
  plugins?: {
    bucket: s3.IBucket;
  };
  worker?: {
    logging: ecs.LogDriver;
  };
}

export class Service extends Construct {
  public readonly api: Api;
  public readonly worker: Worker;

  constructor(scope: Stack, id: string, props: ServiceProps = {}) {
    super(scope, id);

    const table = new dynamodb.Table(this, 'Table', {
      billingMode:
        props.dynamoDb?.billingMode ?? dynamodb.BillingMode.PAY_PER_REQUEST,
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
      table,
      plugins: props.plugins,
      logging: props.worker?.logging,
    });

    // The management API
    this.api = new Api(this, 'Api', {
      defaults: {
        authorizer: 'iam',
        function: {
          environment: {
            DYNAMODB_TABLE_NAME: table.tableName,
            WORKER_STATE_MACHINE_ARN: this.worker.stateMachine.stateMachineArn,
          },
        },
      },
      routes: {
        // Sources
        'GET /sources': 'src/controllers/sources.list',
        'POST /sources': 'src/controllers/sources.create',
        'GET /sources/{id}': 'src/controllers/sources.get',
        'PUT /sources/{id}': 'src/controllers/sources.update',
        'DELETE /sources/{id}': 'src/controllers/sources.destroy',

        // Destinations
        'GET /destinations': 'src/controllers/destinations.list',
        'POST /destinations': 'src/controllers/destinations.create',
        'GET /destinations/{id}': 'src/controllers/destinations.get',
        'PUT /destinations/{id}': 'src/controllers/destinations.update',
        'DELETE /destinations/{id}': 'src/controllers/destinations.destroy',

        // Connections
        'GET /connections': 'src/controllers/connections.list',
        'POST /connections': 'src/controllers/connections.create',
        'GET /connections/{id}': 'src/controllers/connections.get',
        'PUT /connections/{id}': 'src/controllers/connections.update',
        'DELETE /connections/{id}': 'src/controllers/connections.destroy',
        'POST /connections/{id}/abort': 'src/controllers/connections.abort',
        'POST /connections/{id}/run': 'src/controllers/connections.run',

        // Jobs
        'GET /jobs': 'src/controllers/jobs.list',
      },
    });

    this.api.attachPermissions([
      table,
      [this.worker.stateMachine, 'grantStartExecution'],
    ]);
  }
}
