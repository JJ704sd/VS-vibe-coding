// Custom ESM resolver + loader hook for extensionless .ts/.tsx imports and
// type-only import stripping. Loaded via `node --import` in
// package.json's test:unit script.

import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBuiltin } from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.json'];

function detectFormat(url) {
  // .ts files can be handled by Node's built-in strip-types loader (Node 22.6+),
  // so we hand them the 'module-typescript' format which keeps the fast path.
  // .tsx files contain JSX that strip-types cannot compile, so we return
  // 'module' and let our load() hook run ts.transpileModule with the JSX
  // options enabled. Without this split, .tsx files break with
  // "SyntaxError: Unexpected token ':'" the moment they use real JSX syntax.
  // .css files do not exist as JS modules at all — they're consumed by
  // webpack/css-loader at build time. In a Node test runner we have no CSS
  // pipeline, so the resolver/loader stubs them out as empty modules.
  if (url.endsWith('.tsx') || url.endsWith('.css')) return 'module';
  if (url.endsWith('.ts')) return 'module-typescript';
  if (url.endsWith('.json')) return 'json';
  if (url.endsWith('.cjs')) return 'commonjs';
  return 'module';
}

function tryResolveSpecifier(specifier, parentURL) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('/')) {
    return null;
  }
  if (!parentURL) return null;
  const parentPath = fileURLToPath(parentURL);
  const basePath = parentPath.replace(/[/\\][^/\\]+$/, '');
  // If the specifier already has a known extension, let the default loader
  // handle it (preserves CJS detection for .js, .cjs, .json import attrs, etc.).
  if (/\.(?:[cm]?js|json|ts|tsx|mjs|cjs)$/.test(specifier)) {
    return null;
  }
  // Try exact path first
  const direct = `${basePath}/${specifier}`;
  if (existsSync(direct) && statSync(direct).isFile()) {
    return pathToFileURL(direct).href;
  }
  // Try with extensions
  for (const ext of EXTENSIONS) {
    const candidate = `${direct}${ext}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  // Try resolving as a directory with index.*
  for (const ext of EXTENSIONS) {
    const candidate = `${direct}/index${ext}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  if (isBuiltin(specifier)) {
    return nextResolve(specifier, context);
  }
  const resolved = tryResolveSpecifier(specifier, context.parentURL);
  if (resolved) {
    const fmt = detectFormat(resolved);
    if (process.env.TS_RESOLVER_DEBUG) {
      console.error(`[ts-resolver] resolve ${specifier} -> ${resolved} (${fmt})`);
    }
    return { url: resolved, shortCircuit: true, format: fmt };
  }
  return nextResolve(specifier, context);
}

const TS_TRANSFORMS = new Map();

function transformTypeScript(filePath) {
  if (TS_TRANSFORMS.has(filePath)) {
    return TS_TRANSFORMS.get(filePath);
  }
  const source = readFileSync(filePath, 'utf8');
  // JSX is only required for .tsx files; pass it through when needed so the
  // resulting JS is plain ESM that Node can import directly.
  const isTsx = filePath.endsWith('.tsx');
  const result = ts.transpileModule(source, {
    fileName: filePath,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      // Don't type-check; just transform.
      noEmit: false,
      // Strip type-only imports.
      verbatimModuleSyntax: false,
      isolatedModules: true,
      // Compile JSX to plain function calls (react/jsx-runtime) so .tsx files
      // can be loaded by Node without a Babel/TSX loader.
      jsx: isTsx ? ts.JsxEmit.ReactJSX : undefined,
      jsxImportSource: isTsx ? 'react' : undefined,
    },
    reportDiagnostics: false,
  });
  TS_TRANSFORMS.set(filePath, result.outputText);
  return result.outputText;
}

export function load(url, context, nextLoad) {
  if (process.env.TS_RESOLVER_DEBUG) {
    console.error(`[ts-resolver] load ${url} (ctx.format=${context?.format})`);
  }
  if (url.endsWith('.json')) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    return {
      format: 'json',
      source,
      shortCircuit: true,
    };
  }
  if (url.endsWith('.css')) {
    // No CSS pipeline in the Node test runner — return an empty module so
    // `import './index.css'` evaluates to `{ default: {} }` and lets the rest
    // of the graph keep loading.
    return {
      format: 'module',
      source: 'export default {};',
      shortCircuit: true,
    };
  }
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const filePath = fileURLToPath(url);
    const transformed = transformTypeScript(filePath);
    if (process.env.TS_RESOLVER_DEBUG) {
      console.error(`[ts-resolver]   transformed ${filePath}, ${transformed.length} bytes`);
    }
    return {
      format: 'module',
      source: transformed,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
