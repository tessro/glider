import * as fs from 'fs/promises';
import { join, dirname } from 'path';
import { runInNewContext } from 'vm';

import {
  Constructor,
  CredentialsProvider,
  Source,
  Destination,
  PluginExports,
} from 'glider';
import pino from 'pino';

import { Context } from './context';

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

export async function loadPlugins(context: Context): Promise<Plugin[]> {
  const plugins = [];

  for (const filename of await fs.readdir(PLUGIN_DIRECTORY)) {
    const path = join(PLUGIN_DIRECTORY, filename);
    const plugin = await loadPlugin(path, context);
    plugin.activate?.({ options: {} });
    plugins.push(plugin);
  }

  return plugins;
}
