import assert from 'node:assert/strict';
import test from 'node:test';
import { minimaxService, type MinimaxConfig } from './minimaxService.ts';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const proxyConfig: MinimaxConfig = {
  endpoint: 'http://localhost:9999/direct',
  apiKey: 'test-key',
  model: 'abab6.5s-chat',
  useProxy: true,
};

const directConfig: MinimaxConfig = {
  endpoint: 'https://example.com/v1/chat/completions',
  apiKey: 'sk-test',
  model: 'abab6.5s-chat',
  useProxy: false,
};

test('analyzeViaProxy returns normalised predictions when fetch returns a valid payload', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/ecg/analyze');
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'abab6.5s-chat');
    assert.deepEqual(body.signalData, [[0.1, 0.2], [0.3, 0.4]]);
    return jsonResponse({
      predictions: [
        { className: '正常', probability: 0.7 },
        { className: '房颤', probability: 0.3 },
      ],
    });
  };

  const result = await minimaxService.analyzeECG(
    [[0.1, 0.2], [0.3, 0.4]],
    proxyConfig
  );

  assert.equal(result.length, 2);
  // Sorted by probability desc, normalised so total is 1.
  assert.equal(result[0].className, '正常');
  assert.equal(result[1].className, '房颤');
  assert.ok(Math.abs(result[0].probability - 0.7) < 1e-9);
  assert.ok(Math.abs(result[1].probability - 0.3) < 1e-9);
});

test('analyzeViaProxy throws when fetch resolves to a non-2xx response', async () => {
  globalThis.fetch = async () => jsonResponse({ error: 'bad gateway' }, 502);

  await assert.rejects(
    () => minimaxService.analyzeECG([[0]], proxyConfig),
    (err: unknown) => err instanceof Error && /HTTP 502/.test(err.message)
  );
});

test('analyzeViaProxy throws when fetch rejects with a network error', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  await assert.rejects(
    () => minimaxService.analyzeECG([[0]], proxyConfig),
    (err: unknown) => err instanceof Error && /fetch failed/.test(err.message)
  );
});

test('analyzeViaProxy parses predictions embedded in output_text via tryParseJsonFromText', async () => {
  const embedded = JSON.stringify({
    predictions: [
      { className: '室性心动过速', probability: 0.6 },
      { className: '停搏', probability: 0.4 },
    ],
  });

  globalThis.fetch = async () =>
    jsonResponse({
      output_text: `Here is the analysis result: ${embedded} -- end`,
    });

  const result = await minimaxService.analyzeECG([[0]], proxyConfig);
  assert.equal(result.length, 2);
  assert.equal(result[0].className, '室性心动过速');
  assert.equal(result[1].className, '停搏');
  assert.ok(Math.abs(result[0].probability - 0.6) < 1e-9);
});

test('analyzeViaProxy parses predictions nested in choices[0].message.content when output_text is missing', async () => {
  const embedded = JSON.stringify({
    predictions: [{ className: '房颤', probability: 1 }],
  });

  globalThis.fetch = async () =>
    jsonResponse({
      choices: [{ message: { content: embedded } }],
    });

  const result = await minimaxService.analyzeECG([[0]], proxyConfig);
  assert.equal(result.length, 1);
  assert.equal(result[0].className, '房颤');
  assert.equal(result[0].probability, 1);
});

test('analyzeViaProxy throws when the response has no parseable predictions', async () => {
  globalThis.fetch = async () => jsonResponse({ unrelated: 'payload' });

  await assert.rejects(
    () => minimaxService.analyzeECG([[0]], proxyConfig),
    (err: unknown) =>
      err instanceof Error && /未解析到有效 predictions/.test(err.message)
  );
});

test('analyzeDirect throws when endpoint is missing or blank', async () => {
  const missing: MinimaxConfig = { endpoint: '', apiKey: 'k', useProxy: false };
  await assert.rejects(
    () => minimaxService.analyzeECG([[0]], missing),
    (err: unknown) => err instanceof Error && /endpoint/.test(err.message)
  );

  const whitespace: MinimaxConfig = { endpoint: '   ', apiKey: 'k', useProxy: false };
  await assert.rejects(
    () => minimaxService.analyzeECG([[0]], whitespace),
    (err: unknown) => err instanceof Error && /endpoint/.test(err.message)
  );
});

test('analyzeDirect throws when apiKey is missing or blank', async () => {
  const missing: MinimaxConfig = { endpoint: 'https://x', apiKey: '', useProxy: false };
  await assert.rejects(
    () => minimaxService.analyzeECG([[0]], missing),
    (err: unknown) => err instanceof Error && /API Key/.test(err.message)
  );

  const whitespace: MinimaxConfig = { endpoint: 'https://x', apiKey: '   ', useProxy: false };
  await assert.rejects(
    () => minimaxService.analyzeECG([[0]], whitespace),
    (err: unknown) => err instanceof Error && /API Key/.test(err.message)
  );
});

test('analyzeDirect POSTs to the user endpoint with the Bearer apiKey header', async () => {
  let requestedUrl = '';
  let requestedMethod = '';
  let requestedHeaders: Record<string, string> = {};
  let requestedBody: { model?: string; messages?: Array<{ role: string; content?: string }>; temperature?: number } = {};

  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedMethod = String(init?.method);
    requestedHeaders = (init?.headers as Record<string, string>) || {};
    requestedBody = init?.body ? JSON.parse(String(init.body)) : {};
    return jsonResponse({
      predictions: [
        { className: '正常', probability: 0.5 },
        { className: '房颤', probability: 0.5 },
      ],
    });
  };

  const result = await minimaxService.analyzeECG([[1, 2]], directConfig);

  assert.equal(requestedUrl, directConfig.endpoint);
  assert.equal(requestedMethod, 'POST');
  assert.equal(requestedHeaders.Authorization, 'Bearer sk-test');
  assert.equal(requestedHeaders['Content-Type'], 'application/json');
  assert.equal(requestedBody.model, 'abab6.5s-chat');
  assert.equal(Array.isArray(requestedBody.messages), true);
  assert.equal(requestedBody.messages?.[0]?.role, 'system');
  assert.equal(requestedBody.messages?.[1]?.role, 'user');
  assert.equal(requestedBody.temperature, 0.1);
  // Two predictions, normalised, sorted desc.
  assert.equal(result.length, 2);
  assert.equal(result[0].probability, 0.5);
  assert.equal(result[1].probability, 0.5);
});

test('analyzeDirect normalises raw predictions with label/score keys and sorts them by probability', async () => {
  globalThis.fetch = async () =>
    jsonResponse({
      predictions: [
        { label: '正常', score: 0.2 },
        { label: '房颤', score: 0.5 },
        { label: '停搏', score: 0.3 },
      ],
    });

  const result = await minimaxService.analyzeECG([[0]], directConfig);

  assert.equal(result.length, 3);
  // Sorted by probability desc.
  assert.equal(result[0].className, '房颤');
  assert.equal(result[1].className, '停搏');
  assert.equal(result[2].className, '正常');
  // Total normalised to 1.
  const total = result.reduce((s, p) => s + p.probability, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok(Math.abs(result[0].probability - 0.5) < 1e-9);
  assert.ok(Math.abs(result[1].probability - 0.3) < 1e-9);
  assert.ok(Math.abs(result[2].probability - 0.2) < 1e-9);
});

test('analyzeDirect leaves probabilities unchanged when the total is zero (all-zero input)', async () => {
  globalThis.fetch = async () =>
    jsonResponse({
      predictions: [
        { className: 'A', probability: 0 },
        { className: 'B', probability: 0 },
      ],
    });

  const result = await minimaxService.analyzeECG([[0]], directConfig);
  assert.equal(result.length, 2);
  assert.equal(result[0].probability, 0);
  assert.equal(result[1].probability, 0);
  // Order is stable when probabilities are equal.
  assert.equal(result[0].className, 'A');
  assert.equal(result[1].className, 'B');
});
