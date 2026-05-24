import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeAssistantCase, checkAssistantHealth } from './ecgAssistantApi.ts';

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

test('analyzeAssistantCase posts the current case context', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'http://localhost:6090/api/assistant/case/analyze');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>)['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      context: {
        patientId: 'p1',
        recordId: 'r1',
        leadCount: 0,
        primaryLead: 'II',
        annotationCount: 0,
        signalQuality: 88,
        annotations: [],
        aiResults: [],
      },
    });
    return new Response(JSON.stringify({
      status: 'insufficient',
      severity: 'critical',
      summary: 'no leads',
      metrics: [],
      warnings: [],
      recommendations: [],
      sources: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await analyzeAssistantCase({
    patientId: 'p1',
    recordId: 'r1',
    leadCount: 0,
    primaryLead: 'II',
    annotationCount: 0,
    signalQuality: 88,
    annotations: [],
    aiResults: [],
  });

  assert.equal(result.severity, 'critical');
});
