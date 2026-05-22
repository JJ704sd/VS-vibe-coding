import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrainingHistoryDiagnosis, getTrainingHistoryDiagnosis, parseTrainingStreamEvent } from './trainingApi.ts';

test('parseTrainingStreamEvent parses valid JSON event data', () => {
  const result = parseTrainingStreamEvent<{ status: string }>({ data: '{"status":"running"}' } as MessageEvent);

  assert.deepEqual(result, { status: 'running' });
});

test('parseTrainingStreamEvent returns null for malformed JSON event data', () => {
  const result = parseTrainingStreamEvent<{ status: string }>({ data: 'not json' } as MessageEvent);

  assert.equal(result, null);
});

test('buildTrainingHistoryDiagnosis ranks best round and flags zero-f1 anomalies', () => {
  const result = buildTrainingHistoryDiagnosis([
    { round: 'round_1', number: 1, dataset: 'MIT-BIH', best_f1: 0.8, test_accuracy: 0.82, path: 'r1' },
    { round: 'round_2', number: 2, dataset: 'MIT-BIH', best_f1: 0.0, test_accuracy: 0.0, path: 'r2' },
    { round: 'round_3', number: 3, dataset: 'MIT-BIH', best_f1: 0.9, test_accuracy: 0.91, path: 'r3' },
  ]);

  assert.equal(result.bestRound?.round, 'round_3');
  assert.equal(result.rankedRounds[0].round, 'round_3');
  assert.equal(result.severity, 'warning');
  assert.equal(result.anomalies[0].round, 'round_2');
});

test('buildTrainingHistoryDiagnosis handles parsed CPSC history metadata', () => {
  const result = buildTrainingHistoryDiagnosis([
    {
      round: 'round_11',
      number: 11,
      dataset: 'MIT-BIH',
      best_f1: 0.8912,
      test_accuracy: 0.8925,
      path: 'outputs/round_11',
      source_type: 'evaluation_json',
      status: 'completed',
      epoch_count: 10,
    },
    {
      round: 'cpsc2018_binary_v2_focal_mixup_tta',
      number: 0,
      dataset: 'cpsc2018_binary_v2_focal_mixup_tta',
      best_f1: 0.704558,
      test_accuracy: 0.832122,
      path: 'outputs/cpsc2018_binary_v2_focal_mixup_tta',
      source_type: 'history_csv',
      status: 'completed',
      epoch_count: 28,
      best_epoch: 20,
      best_auc: 0.795448,
      best_threshold: 0.475,
    },
  ]);

  assert.equal(result.bestRound?.round, 'round_11');
  assert.equal(result.rankedRounds[1].source_type, 'history_csv');
  assert.equal(result.severity, 'info');
});

test('getTrainingHistoryDiagnosis falls back to current history data when diagnosis endpoint is missing', async () => {
  const requestedUrls: string[] = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).endsWith('/api/assistant/training/history/diagnose')) {
      return new Response('not found', { status: 404 });
    }
    return new Response(
      JSON.stringify([
        { round: 'round_1', number: 1, dataset: 'MIT-BIH', best_f1: 0.7, test_accuracy: 0.72, path: 'r1' },
        { round: 'round_2', number: 2, dataset: 'MIT-BIH', best_f1: 0.88, test_accuracy: 0.89, path: 'r2' },
      ]),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const result = await getTrainingHistoryDiagnosis();

  assert.equal(result.bestRound?.round, 'round_2');
  assert.deepEqual(requestedUrls, [
    'http://localhost:6090/api/assistant/training/history/diagnose',
    'http://localhost:6090/api/training/history',
  ]);
});
