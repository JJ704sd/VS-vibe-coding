export interface RequestJsonOptions<T> {
  baseUrl: string;
  path: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fallback?: (error: unknown) => T | Promise<T>;
}

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export const isNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' ||
    error.name === 'TypeError' ||
    error.message.includes('fetch') ||
    error.message.includes('Failed to fetch') ||
    error.message.includes('NetworkError') ||
    error.message.includes('Network request failed') ||
    error.message.includes('ECONNREFUSED') ||
    error.message.includes('ETIMEDOUT')
  );
};

const buildUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

async function parseJsonResponse<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ParseError(error instanceof Error ? error.message : 'Failed to parse JSON response');
  }
}

export async function requestJson<T>(options: RequestJsonOptions<T>): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const hasBody = typeof options.body !== 'undefined' && options.body !== null;
  const controller = options.timeoutMs ? new AbortController() : null;
  const timeout = controller
    ? window.setTimeout(() => controller.abort(), options.timeoutMs)
    : null;

  try {
    const response = await fetch(buildUrl(options.baseUrl, options.path), {
      method,
      headers: {
        ...(hasBody && method !== 'GET' && method !== 'HEAD' ? { 'Content-Type': 'application/json' } : {}),
        Accept: 'application/json',
        ...(options.headers || {}),
      },
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: controller?.signal,
    });

    if (!response.ok) {
      throw new HttpError(response.status, `Request failed with status ${response.status}`);
    }

    return parseJsonResponse<T>(response);
  } catch (error) {
    if (options.fallback && isNetworkError(error)) {
      return options.fallback(error);
    }
    throw error;
  } finally {
    if (timeout !== null) {
      window.clearTimeout(timeout);
    }
  }
}
