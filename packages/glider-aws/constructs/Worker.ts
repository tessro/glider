import * as sst from '@serverless-stack/resources';
import {
  Duration,
  aws_dynamodb as dynamodb,
  aws_ecs as ecs,
  aws_iam as iam,
  aws_logs as logs,
  aws_s3 as s3,
  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as tasks,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

interface WorkerProps {
  logging?: ecs.LogDriver;
  plugins?: {
    bucket: s3.IBucket;
  };
  table: dynamodb.ITable;
  timeout?: Duration;
}

const defaultProps: Partial<WorkerProps> = {
  logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'glider' }),
  timeout: Duration.hours(24),
};

export class Worker extends Construct {
  public readonly stateMachine: sfn.StateMachine;
  public readonly taskDefinition: ecs.TaskDefinition;

  private readonly props: WorkerProps;

  constructor(scope: Construct, id: string, props: WorkerProps) {
    super(scope, id);

    this.props = {
      ...defaultProps,
      ...props,
    };

    const beforeSyncFn = new sst.Function(this, 'BeforeSyncFn', {
      handler: 'src/state-machine/index.beforeSync',
    });

    const afterSyncFn = new sst.Function(this, 'AfterSyncFn', {
      handler: 'src/state-machine/index.afterSync',
    });

    const afterSleepFn = new sst.Function(this, 'AfterSleepFn', {
      handler: 'src/state-machine/index.afterSleep',
    });

    const invokeSelfFn = new sst.Function(this, 'InvokeSelfFn', {
      handler: 'src/state-machine/index.invokeSelf',
    });

    const beforeSync = new tasks.LambdaInvoke(this, 'Before sync', {
      lambdaFunction: beforeSyncFn,
      resultPath: '$.state',
    });

    const afterSync = new tasks.LambdaInvoke(this, 'After sync', {
      lambdaFunction: afterSyncFn,
      resultPath: '$.state',
    });

    const afterSleep = new tasks.LambdaInvoke(this, 'After sleep', {
      lambdaFunction: afterSleepFn,
      resultPath: '$.state',
    });

    const waitUntil = new sfn.Wait(this, 'Wait until X', {
      time: sfn.WaitTime.timestampPath('$.state.Payload.waitUntil'),
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      containerInsights: true,
    });

    this.taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'TaskDefinition',
      {
        runtimePlatform: {
          // Use Graviton2 architecture
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      }
    );

    const containerDefinition = this.taskDefinition.addContainer('Worker', {
      image: ecs.ContainerImage.fromAsset('../..', {
        file: 'packages/glider-runner/Dockerfile',
      }),
      environment: {
        PLUGINS_BUCKET_NAME: this.props.plugins?.bucket.bucketName ?? '',
      },
      logging: props.logging,
    });

    const syncTask = new tasks.EcsRunTask(this, 'Sync', {
      cluster,
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      launchTarget: new tasks.EcsFargateLaunchTarget(),
      taskDefinition: this.taskDefinition,
      containerOverrides: [
        {
          containerDefinition,
          command: sfn.JsonPath.listAt('$.state.Payload.runnerArgs'),
        },
      ],
      resultPath: '$.state',
    });

    // Ensure the worker can read the S3 bucket containing plugins
    this.props.plugins?.bucket.grantRead(this.taskDefinition.taskRole);

    // Step Functions has built-in support for starting execution of Step
    // Functions, but we can't use it because it from here, since it would
    // create a circular reference. (We don't know our Step Function's ARN until
    // after it's created.) We work around that by invoking a Lambda that uses
    // the Step Functions API.
    const invokeSelf = new tasks.LambdaInvoke(this, 'Invoke self', {
      lambdaFunction: invokeSelfFn,
    });

    const unknownAction = new sfn.Fail(this, 'Unknown action');
    const done = new sfn.Succeed(this, 'Done');
    const cleanup = afterSync
      .next(waitUntil)
      .next(afterSleep)
      .next(
        new sfn.Choice(this, 'Should loop?')
          // If the schedule was changed, we might have woken up too early,
          // and should sleep.
          .when(
            sfn.Condition.stringEquals('$.state.Payload.action', 'WAIT'),
            waitUntil
          )
          // If another job kicked off while we're sleeping, or if the
          // connection configuration was deleted, we need to terminate.
          .when(
            sfn.Condition.stringEquals('$.state.Payload.action', 'TERMINATE'),
            done
          )
          // Otherwise, it's time to reinvoke the state machine.
          .when(
            sfn.Condition.stringEquals('$.state.Payload.action', 'LOOP'),
            invokeSelf.next(done)
          )
          .otherwise(unknownAction)
      );

    const definition = beforeSync.next(
      new sfn.Choice(this, 'Should run?')
        // If we got a Job ID, that means we have a ticket to sync, and should
        // do so. If we weren't issued one, it means another job is running, so
        // we can safely terminate.
        .when(
          sfn.Condition.stringEquals('$.state.Payload.action', 'RUN'),
          syncTask.next(cleanup)
        )
        .when(
          sfn.Condition.stringEquals('$.state.Payload.action', 'TERMINATE'),
          done
        )
        .otherwise(unknownAction)
    );

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      logs: {
        destination: new logs.LogGroup(this, 'Glider', {
          // TODO(ptr): switch to prefixes when support is added
          // See: https://github.com/aws/aws-cdk/issues/19353
          // In the meantime, changes to this log group that require a
          // remove-and-replace will cause a CloudFormation error. If that
          // becomes a maintenance issue we can make this configurable.
          logGroupName: '/aws/vendedlogs/states/glider',
        }),
        level: sfn.LogLevel.ALL,
      },
      timeout: this.props.timeout,
    });

    // Allow the state machine to invoke itself. Since this would normally
    // create a circular reference, we add a policy using a wildcard. This does
    // mean that our Lambda could potentially invoke other step functions with
    // the same prefix, so we use `Glider` explicitly in the state machine name.
    invokeSelfFn.role?.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['states:StartExecution'],
        resources: [
          `arn:aws:states:*:*:stateMachine:GliderWorkerStateMachine*`,
        ],
      })
    );

    this.props.table.grantReadWriteData(beforeSyncFn);
    this.props.table.grantReadWriteData(afterSyncFn);
    this.props.table.grantReadData(afterSleepFn);
    this.props.table.grantWriteData(invokeSelfFn);
  }
}
