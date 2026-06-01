// Test bootstrap: register the TypeScript resolver hook and start the test runner.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const resolverPath = pathResolve(here, 'ts-resolver.mjs');
const resolverUrl = pathToFileURL(resolverPath).href;
const parentUrl = pathToFileURL(here + '/').href;
register(resolverUrl, parentUrl);
