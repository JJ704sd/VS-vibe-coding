import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError, requestJson } from './httpClient.ts';

test('requestJson sends JSON headers and parses the JSON response', async () => {
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;

  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await requestJson<{ ok: boolean }>({
    baseUrl: 'http://localhost:4000/api',
    path: '/patients',
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(requestedUrl, 'http://localhost:4000/api/patients');
  assert.equal((requestedInit?.headers as Record<string, string>).Accept, 'application/json');
});

test('requestJson throws HttpError for non-2xx responses', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: 'bad request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

  await assert.rejects(
    () => requestJson({ baseUrl: 'http://localhost:4000/api', path: '/patients' }),
    (error: unknown) => error instanceof HttpError && error.status === 400
  );
});

test('requestJson returns fallback when a network error occurs', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const result = await requestJson({
    baseUrl: 'http://localhost:4000/api',
    path: '/patients',
    fallback: () => ({ patients: [] }),
  });

  assert.deepEqual(result, { patients: [] });
});
