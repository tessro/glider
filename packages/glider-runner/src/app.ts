import { CredentialsProvider } from 'glider';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import yargs from 'yargs';

import { InMemoryContext } from './context';
import { Job } from './job';
import { loadPlugins } from './plugins';

const logger = pino();

logger.info({
  msg: '🛫 Glider runner booting up...',
});

function die(o: unknown): never {
  logger.error(o);
  logger.flush();
  process.exit(1);
}

async function main() {
  const args = await yargs(process.argv)
    .option('destination', {
      alias: 'd',
      describe: 'The destination to write to',
      demandOption: true,
      requiresArg: true,
      type: 'string',
    })
    .option('destination-options', {
      coerce: JSON.parse,
      describe: 'JSON configuration object for the destination',
      requiresArg: true,
    })
    .option('destination-credentials', {
      coerce: JSON.parse,
      describe: 'JSON configuration object for destination credentials',
      requiresArg: true,
    })
    .option('source', {
      alias: 's',
      describe: 'The source to read from',
      demandOption: true,
      requiresArg: true,
      type: 'string',
    })
    .option('source-options', {
      coerce: JSON.parse,
      describe: 'JSON configuration object for the source',
      requiresArg: true,
    })
    .option('source-credentials', {
      coerce: JSON.parse,
      describe: 'JSON configuration object for source credentials',
      requiresArg: true,
    })
    .alias('h', 'help')
    .alias('v', 'version').argv;

  logger.info({
    msg: `Connection configuration: ${args.source} -> ${args.destination}`,
    source: {
      type: args.source,
      options: args.sourceOptions,
    },
    destination: {
      type: args.destination,
      options: args.destinationOptions,
    },
  });

  const context = new InMemoryContext();
  const plugins = await loadPlugins(context);
  logger.info({
    msg: `Loaded ${plugins.length} plugins`,
    plugins,
  });

  const source = context.sources.get(args.source);
  if (!source) {
    die({
      msg: `Couldn't find source of type '${args.source}'`,
    });
  }

  const destination = context.destinations.get(args.destination);
  if (!destination) {
    die({
      msg: `Couldn't find destination of type '${args.destination}'`,
    });
  }

  function getCredentialsProvider(options: any): CredentialsProvider {
    if (options?.provider) {
      const provider = context.credentials.get(options.provider);
      if (!provider) {
        die({
          msg: `Couldn't find credentials provider '${options.provider}'`,
        });
      }

      return new provider(options);
    } else {
      // If no provider is specified, pass credentials directly
      return {
        get() {
          return options;
        },
      };
    }
  }

  const sourceProvider = getCredentialsProvider(args.sourceCredentials);
  const destinationProvider = getCredentialsProvider(
    args.destinationCredentials
  );

  const job = new Job({
    id: uuidv4(),
    context,
    credentials: {
      [args.source]: sourceProvider,
      [args.destination]: destinationProvider,
    },
    source: new source(args.sourceOptions),
    destination: new destination(args.destinationOptions),
  });

  await job.run();
}

main();
