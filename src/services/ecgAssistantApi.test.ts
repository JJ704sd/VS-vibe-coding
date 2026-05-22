import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAssistantHealth } from './ecgAssistantApi.ts';

test('checkAssistantHealth returns available when the sidecar health endpoint responds ok', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'http://localhost:6090/health');
    return new Response(JSON.stringify({ status: 'ok', service: 'ecgfounder-sidecar' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await checkAssistantHealth();

  assert.deepEqual(result, {
    available: true,
    service: 'ecgfounder-sidecar',
    message: '助手服务已连接',
  });
});

test('checkAssistantHealth returns unavailable when the sidecar cannot be reached', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const result = await checkAssistantHealth();

  assert.deepEqual(result, {
    available: false,
    message: '助手服务未启动',
  });
});
