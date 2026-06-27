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
  if (url.endsWith('.ts') || url.endsWith('.tsx')) return 'module-typescript';
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
    return { url: resolved, shortCircuit: true, format: detectFormat(resolved) };
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
  if (url.endsWith('.json')) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    return {
      format: 'json',
      source,
      shortCircuit: true,
    };
  }
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const filePath = fileURLToPath(url);
    const transformed = transformTypeScript(filePath);
    return {
      format: 'module',
      source: transformed,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
