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

// ── C-11 regression: the direct-call branch was removed ──────────────────
//
// Audit `2026-07-07-track-C-assistant-training-minimax.md` §4.2 found that
// `useProxy=false` made the browser fetch a user-supplied endpoint while
// attaching the user-supplied API key as `Authorization: Bearer <key>`.
// That branch is gone; the tests below pin the new contract.

test('useProxy=false is ignored: the request still hits /api/ecg/analyze', async () => {
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return jsonResponse({
      predictions: [
        { className: '正常', probability: 0.5 },
        { className: '房颤', probability: 0.5 },
      ],
    });
  };

  // Even with `useProxy: false` and a real-looking endpoint/apiKey,
  // the service must NOT honour them: it must route through the
  // sidecar proxy and never include the user-supplied API key in the
  // outbound request headers.
  await minimaxService.analyzeECG([[0]], {
    endpoint: 'https://attacker.example/collect',
    apiKey: 'sk-leaked',
    model: 'abab6.5s-chat',
    useProxy: false,
  });

  assert.equal(requestedUrl, '/api/ecg/analyze');
});

test('analyzeECG never sends an Authorization header (useProxy path is keyless)', async () => {
  let requestedHeaders: Record<string, string> = {};
  globalThis.fetch = async (_url, init) => {
    requestedHeaders = (init?.headers as Record<string, string>) || {};
    return jsonResponse({
      predictions: [{ className: '正常', probability: 1 }],
    });
  };

  await minimaxService.analyzeECG([[0]], {
    endpoint: 'https://attacker.example/collect',
    apiKey: 'sk-leaked',
    useProxy: true,
  });

  // The proxy route on the sidecar is responsible for the bearer token;
  // the browser must never carry the user's API key.
  assert.equal(requestedHeaders.Authorization, undefined);
  assert.equal(requestedHeaders.authorization, undefined);
  assert.equal(requestedHeaders['Content-Type'], 'application/json');
});

test('analyzeECG works with an empty config (only model is required)', async () => {
  globalThis.fetch = async (url, init) => {
    // No `model` in the config → default `abab6.5s-chat` is used.
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'abab6.5s-chat');
    return jsonResponse({
      predictions: [{ className: '正常', probability: 1 }],
    });
  };

  const result = await minimaxService.analyzeECG([[0]], {});
  assert.equal(result.length, 1);
  assert.equal(result[0].className, '正常');
});

test('analyzeECG accepts a model override without endpoint/apiKey', async () => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'minimax-text-01');
    return jsonResponse({
      predictions: [{ className: '正常', probability: 1 }],
    });
  };

  const result = await minimaxService.analyzeECG([[0]], { model: 'minimax-text-01' });
  assert.equal(result.length, 1);
});
