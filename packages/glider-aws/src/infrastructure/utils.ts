import { existsSync } from 'node:fs';

/**
 * Resolves the full path to the provided script, adding `.js` or `.ts`.
 *
 * @remarks
 *
 * Various aspects of the CDK use direct filesystem path references. This
 * presents a unique problem when bundling CDK code written in TypeScript,
 * since those references have `.ts` extensions in development and `.js`
 * extensions in the packaged npm artifact.
 *
 * This utility function addresses the problem by checking for the presence of
 * a file with either extension, allowing calling code to work when developing
 * this module as well as when the module is installed.
 */
export function resolveScript(path: string): string {
  for (const ext of ['.js', '.ts']) {
    const fullPath = path + ext;
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  throw new Error(`No JavaScript or TypeScript file found at path: ${path}`);
}
