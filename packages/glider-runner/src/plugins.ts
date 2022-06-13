import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import { createRequire } from 'module';
import * as path from 'path';
import { join, dirname } from 'path';
import type { Readable } from 'stream';
import { runInNewContext } from 'vm';

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import {
  Constructor,
  CredentialsProvider,
  Source,
  Destination,
  PluginExports,
} from '@balsahq/glider';
import mkdirp from 'mkdirp';
import { pino } from 'pino';
import { fromBuffer, ZipFile } from 'yauzl';

import { Context } from './context.js';

interface Plugin extends PluginExports {
  name: string;
  version: string;
}

const logger = pino();

// The location in the container to scan for plugins. Consumers install plugins
// by bind-mounting them into this directory in their Docker configuration.
const PLUGIN_DIRECTORY = '/app/plugins';

async function readFileToString(path: string): Promise<string> {
  const buf = await fs.readFile(path);
  return buf.toString();
}

async function loadPlugin(path: string, context: Context): Promise<Plugin> {
  logger.info({
    msg: `Found plugin at ${path}`,
    path,
  });

  // Read the package manifest to find the location of the main source file
  const manifestPath = join(path, 'package.json');
  const manifest = JSON.parse(await readFileToString(manifestPath));
  const main = manifest.main;

  // Read the main source file
  const mainPath = join(path, main);
  const mainSrc = await readFileToString(mainPath);

  // The `glider` global, a special global object available to plugins.
  // Inserting this object is one of the main motivations for using a VM.
  const glider = {
    credentials: {
      registerProvider: (
        id: string,
        provider: Constructor<CredentialsProvider>
      ) => context.credentials.register(id, provider),
    },
    sources: {
      register: (id: string, constructor: Constructor<Source>) =>
        context.sources.register(id, constructor),
    },
    destinations: {
      register: (id: string, constructor: Constructor<Destination>) =>
        context.destinations.register(id, constructor),
    },
  };

  // Retain a handle to the module object, so we can access exports
  const module = {
    exports: {},
  };

  // Plugins are CommonJS, so they need a `require` function. The ESM context
  // doesn't include one, so we need to make one.
  const require = createRequire(import.meta.url);

  // This object becomes the global namespace in the plugin's execution context
  const ctx = {
    Buffer,
    __filename: mainPath,
    __dirname: dirname(mainPath),
    console,
    global,
    module,
    require: (id: string) => {
      if (id === 'glider') return glider;
      return require(id);
    },
    process,
  };

  // Execute the plugin's main script. It mutates the context object. The plugin
  // runs in its own execution context so we can inject the global `glider`
  // object, and to prevent pollution of our main execution context. This is
  // *NOT* a security measure -- plugins can do bad things if they're
  // determined to cause mayhem.
  //
  // `vm2` would provide better isolation if we ever want to run unsafe code. I
  // originally tried using it instead of Node's `vm`, but it uses proxy objects
  // to provide isolation, and proxies have limitations that caused many Node
  // modules to break. It would take a lot of work that's not worth it yet. For
  // now, users should take the same care with plugins that they do for the rest
  // of their software supply chain.
  runInNewContext(mainSrc, ctx);

  return {
    ...module.exports,
    name: manifest.name,
    version: manifest.version,
  };
}

async function fetchPluginsFromS3(bucketName: string): Promise<void> {
  const region = process.env.AWS_REGION ?? 'us-west-2';
  const client = new S3Client({ region });
  const listCommand = new ListObjectsV2Command({
    Bucket: bucketName,
  });

  logger.info({
    msg: 'Fetching plugins from S3',
    region,
    bucket: bucketName,
  });

  const result = await client.send(listCommand);
  if (!result.Contents) {
    logger.warn({
      msg: 'S3 `ListObjectsV2` response did not contain a `Contents` field, aborting',
    });
    return;
  }

  for (const entry of result.Contents) {
    const key = entry.Key;
    if (!key) {
      logger.warn({
        msg: 'Encountered entry with no key while parsing S3 `ListObjectsV2` response, skipping',
        bucket: bucketName,
        key,
      });
      continue;
    }

    logger.info({
      msg: `Found '${key}' in S3, downloading...`,
      region,
      bucket: bucketName,
      key,
    });

    const cmd = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const result = await client.send(cmd);
    if (!result.Body) {
      logger.warn({
        msg: `S3 object '${key}' returned no data`,
        bucket: bucketName,
        key,
      });
      continue;
    }

    // Compose plugin path from zipfile name, ignoring directories. Since our
    // filesystem scan doesn't traverse subdirectories, replicating nested
    // structure would be pointless. This introduces the possibility of
    // conflicts, e.g. `s3://a/b/plugin.zip` and `s3://a/c/plugin.zip` would
    // both be computed as `plugin`. For now that seems like an easy edge case
    // to avoid.
    const basename = path.basename(key, '.zip');
    const pluginDirectory = path.join(PLUGIN_DIRECTORY, basename);
    const buffer = await streamToBuffer(result.Body);

    logger.info({
      msg: `Unpacking '${key}' into '${pluginDirectory}'`,
      source: key,
      destination: pluginDirectory,
    });

    await unpack(pluginDirectory, buffer);

    logger.info({
      msg: `Finished unpacking '${key}'`,
      source: key,
      destination: pluginDirectory,
    });
  }
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.once('end', () => resolve(Buffer.concat(chunks)));
    stream.once('error', reject);
  });
}

async function unpack(rootDir: string, contents: Buffer): Promise<void> {
  // Ensure directory exists
  await mkdirp(rootDir);

  return new Promise((resolve, reject) => {
    fromBuffer(
      contents,
      { lazyEntries: true },
      (err: Error | null, zipfile: ZipFile) => {
        if (err) {
          return reject(err);
        }

        zipfile.readEntry();

        zipfile.on('end', () => {
          resolve();
        });

        zipfile.on('entry', (entry) => {
          const destination = path.join(rootDir, entry.fileName);
          if (destination.endsWith('/')) {
            logger.info({
              msg: `Creating directory '${destination}'`,
              path: destination,
            });

            mkdirp(destination).then(() => {
              zipfile.readEntry();
            });
          } else {
            mkdirp(path.dirname(destination)).then(() => {
              zipfile.openReadStream(entry, (err, readStream) => {
                if (err) {
                  return reject(err);
                }

                const writeStream = createWriteStream(destination, {
                  flags: 'w',
                });
                logger.info({
                  msg: `Unpacking file '${entry.fileName}'`,
                  path: entry.fileName,
                });
                readStream.pipe(writeStream);
                writeStream.on('close', () => {
                  zipfile.readEntry();
                });
              });
            });
          }
        });
      }
    );
  });
}

async function loadPluginsFromVolume(context: Context): Promise<Plugin[]> {
  const plugins = [];

  for (const filename of await fs.readdir(PLUGIN_DIRECTORY)) {
    const path = join(PLUGIN_DIRECTORY, filename);
    const plugin = await loadPlugin(path, context);
    plugin.activate?.({ options: {} });
    plugins.push(plugin);
  }

  return plugins;
}

export async function loadPlugins(context: Context): Promise<Plugin[]> {
  if (process.env.PLUGINS_BUCKET_NAME) {
    await fetchPluginsFromS3(process.env.PLUGINS_BUCKET_NAME);
  }

  return loadPluginsFromVolume(context);
}
