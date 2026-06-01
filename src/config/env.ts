/**
 * Runtime configuration constants.
 *
 * The values are read from `process.env` so that webpack's DefinePlugin can
 * replace them at build time. The plugin rewrites literal references such as
 *   process.env.CLINIC_API_BASE_URL
 * with the literal value loaded from the .env file (dev) or the shell
 * environment (prod). If the variable is missing, DefinePlugin replaces it
 * with `undefined`, which means the `||` fallback in this file kicks in and
 * the project still runs against the demo local sidecar.
 *
 * Note: DefinePlugin can only substitute textual `process.env.X` references,
 * so we read each key directly (no `process.env[key]` dynamic lookup) and
 * the fallbacks are evaluated against the substituted value.
 *
 * In Node test runs (e.g. `node --test`) the webpack replacement does NOT
 * happen, so the `process.env.X` references fall through to actual
 * `process.env` lookups, which are `undefined` unless the test harness sets
 * them. The `||` fallback keeps the existing localhost-based unit tests
 * passing.
 */

const clinicFallback = 'http://localhost:4000/api';
const sidecarFallback = 'http://localhost:6090';

const isDevMode = (): boolean => {
  // `process.env.NODE_ENV` is replaced by webpack too; the literal keeps
  // this guard working in both the bundle and the Node test runner.
  return (process.env.NODE_ENV || 'development') !== 'production';
};

/**
 * Backend address for the clinic / mock API (used by `src/services/clinicApi.ts`).
 * Defaults to the bundled mock-api server on port 4000.
 */
export const CLINIC_API_BASE_URL: string =
  process.env.CLINIC_API_BASE_URL || clinicFallback;

/**
 * Backend address for the training / ECGFounder sidecar (used by
 * `src/services/trainingApi.ts`).
 */
export const TRAINING_API_BASE_URL: string =
  process.env.TRAINING_API_BASE_URL || sidecarFallback;

/**
 * Backend address for the local assistant / RAG sidecar (used by
 * `src/services/ecgAssistantApi.ts`).
 */
export const ASSISTANT_API_BASE_URL: string =
  process.env.ASSISTANT_API_BASE_URL || sidecarFallback;

/**
 * Local proxy endpoint that forwards Minimax calls server-side. The proxy
 * lives on the same host as the served bundle (relative URL), so it does
 * not need to be parameterised by environment.
 */
export const MINIMAX_PROXY_ENDPOINT: string = '/api/ecg/analyze';

export interface EnvConfigSnapshot {
  clinicApiBaseUrl: string;
  trainingApiBaseUrl: string;
  assistantApiBaseUrl: string;
  minimaxProxyEndpoint: string;
  isDev: boolean;
}

/**
 * Debug helper that returns a plain-object snapshot of the current
 * configuration. Intended to be logged once during dev startup; never
 * expose secrets here.
 */
export const getEnvConfig = (): EnvConfigSnapshot => ({
  clinicApiBaseUrl: CLINIC_API_BASE_URL,
  trainingApiBaseUrl: TRAINING_API_BASE_URL,
  assistantApiBaseUrl: ASSISTANT_API_BASE_URL,
  minimaxProxyEndpoint: MINIMAX_PROXY_ENDPOINT,
  isDev: isDevMode(),
});

if (isDevMode() && typeof console !== 'undefined') {
  // eslint-disable-next-line no-console
  console.info('[env] runtime config:', getEnvConfig());
}
