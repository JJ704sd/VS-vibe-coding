import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPatient,
  getDashboardOverview,
  getPatientBundle,
  getPatients,
} from './clinicApi.ts';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('getDashboardOverview returns the parsed metrics when fetch succeeds', async () => {
  const expected = {
    sourceLabel: 'live',
    metrics: [
      { title: '患者总数', value: 12, note: 'live', accent: 'metric-card--blue' },
    ],
    recentActivities: ['a'],
    diagnosisStats: [{ name: 'A', value: 1, color: 'red' }],
  };

  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'http://localhost:4000/api/dashboard');
    return jsonResponse(expected);
  };

  const result = await getDashboardOverview();
  assert.deepEqual(result, expected);
});

test('getDashboardOverview falls back to mock metrics when fetch fails with a network error', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const result = await getDashboardOverview();
  assert.equal(result.sourceLabel, 'PTB-XL 20 条备份');
  assert.equal(Array.isArray(result.metrics), true);
  assert.equal(result.metrics.length, 4);
  assert.equal(result.metrics[0].title, '患者总数');
  assert.equal(Array.isArray(result.recentActivities), true);
  assert.equal(Array.isArray(result.diagnosisStats), true);
});

test('getDashboardOverview rethrows non-network errors', async () => {
  globalThis.fetch = async () => jsonResponse({ message: 'bad' }, 500);

  await assert.rejects(getDashboardOverview, (err: unknown) => {
    return err instanceof Error && /status 500/.test(err.message);
  });
});

test('getPatients returns the parsed list when fetch succeeds', async () => {
  const expected = {
    sourceLabel: 'live',
    patients: [
      { id: 'P001', name: 'Alice', age: 30, gender: 'F', records: [], createdAt: 't', updatedAt: 't' },
    ],
  };

  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'http://localhost:4000/api/patients');
    return jsonResponse(expected);
  };

  const result = await getPatients();
  assert.deepEqual(result, expected);
});

test('getPatients falls back to mock patients when fetch fails with a network error', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const result = await getPatients();
  assert.equal(result.sourceLabel, 'PTB-XL 20 条备份');
  assert.equal(Array.isArray(result.patients), true);
  assert.equal(result.patients.length > 0, true);
  for (const patient of result.patients) {
    assert.equal(typeof patient.id, 'string');
    assert.equal(typeof patient.name, 'string');
  }
});

test('getPatientBundle returns the parsed bundle when fetch succeeds', async () => {
  const expected = {
    sourceLabel: 'live',
    patient: { id: 'P001', name: 'Alice', age: 30, gender: 'F' as const, records: [], createdAt: 't', updatedAt: 't' },
    record: null,
  };

  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'http://localhost:4000/api/patients/P001');
    return jsonResponse(expected);
  };

  const result = await getPatientBundle('P001');
  assert.deepEqual(result, expected);
});

test('getPatientBundle falls back to a null bundle when the patient is not found in mocks', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const result = await getPatientBundle('NONEXISTENT_PATIENT_ID');
  assert.equal(result.sourceLabel, 'PTB-XL 20 条备份');
  assert.equal(result.patient, null);
  assert.equal(result.record, null);
});

test('createPatient POSTs the input and returns the new patient from the response', async () => {
  let requestedUrl = '';
  let requestedMethod = '';
  let requestedBody: unknown;

  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedMethod = String(init?.method);
    requestedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    return jsonResponse({
      patient: {
        id: 'P999',
        name: 'Bob',
        age: 42,
        gender: 'M',
        records: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    });
  };

  const result = await createPatient({ name: 'Bob', age: 42, gender: 'M' });
  assert.equal(requestedUrl, 'http://localhost:4000/api/patients');
  assert.equal(requestedMethod, 'POST');
  assert.deepEqual(requestedBody, { name: 'Bob', age: 42, gender: 'M' });
  assert.equal(result.id, 'P999');
  assert.equal(result.name, 'Bob');
  assert.equal(result.gender, 'M');
});

test('createPatient returns a locally-synthesised patient with a generated id when fetch fails', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const result = await createPatient({ name: 'Carol', age: 50, gender: 'F' });
  assert.match(result.id, /^P\d{3,}$/);
  assert.equal(result.name, 'Carol');
  assert.equal(result.age, 50);
  assert.equal(result.gender, 'F');
  assert.equal(Array.isArray(result.records), true);
  assert.equal(result.records.length, 0);
  assert.equal(typeof result.createdAt, 'string');
  assert.equal(typeof result.updatedAt, 'string');
});

// Redundant with the "many consecutive failed calls" test below — that one
// already iterates 5 fallbacks and asserts the issued Set stays at size 5,
// which is strictly stronger than the 2-call version. Kept here as a
// regression comment so the next person doesn't re-add the lighter variant.

test('createPatient fallback ids remain stable and unique across many consecutive failed calls', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const issued = new Set<string>();
  for (let i = 0; i < 5; i += 1) {
    const patient = await createPatient({
      name: `Fallback User ${i}`,
      age: 30 + i,
      gender: i % 2 === 0 ? 'M' : 'F',
    });
    assert.equal(
      issued.has(patient.id),
      false,
      `duplicate fallback id on iteration ${i}: ${patient.id}`,
    );
    issued.add(patient.id);
  }
  assert.equal(issued.size, 5);
});
