import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTrainingRoundDetails } from './trainingRoundDetails.ts';

test('loadTrainingRoundDetails keeps log data when eval is missing', async () => {
  const result = await loadTrainingRoundDetails('round_4', {
    getHistoryLog: async () => ({ round: 'round_4', epochs: [{ epoch: 1 }] as any }),
    getHistoryEval: async () => {
      throw new Error('Evaluation for round_4 not found');
    },
    getHistoryParamStats: async () => null,
  });

  assert.equal(result.epochs.length, 1);
  assert.equal(result.evalData, null);
  assert.equal(result.paramHistory, null);
  assert.deepEqual(result.missing, ['eval']);
});

test('loadTrainingRoundDetails keeps eval and param data when log is missing', async () => {
  const result = await loadTrainingRoundDetails('round_2', {
    getHistoryLog: async () => {
      throw new Error('Log for round_2 not found');
    },
    getHistoryEval: async () => ({ model: 'round_2' }) as any,
    getHistoryParamStats: async () => ({ round: 'round_2', epochs: [] }),
  });

  assert.deepEqual(result.epochs, []);
  assert.equal(result.evalData?.model, 'round_2');
  assert.equal(result.paramHistory?.round, 'round_2');
  assert.deepEqual(result.missing, ['log']);
});

test('loadTrainingRoundDetails returns all three payloads on happy path', async () => {
  const result = await loadTrainingRoundDetails('round_1', {
    getHistoryLog: async () => ({ round: 'round_1', epochs: [{ epoch: 1 }, { epoch: 2 }] as any }),
    getHistoryEval: async () => ({ model: 'round_1' }) as any,
    getHistoryParamStats: async () => ({ round: 'round_1', epochs: [] }),
  });

  assert.equal(result.epochs.length, 2);
  assert.equal(result.evalData?.model, 'round_1');
  assert.equal(result.paramHistory?.round, 'round_1');
  assert.deepEqual(result.missing, []);
});

test('loadTrainingRoundDetails flags all three sources when everything rejects', async () => {
  const result = await loadTrainingRoundDetails('round_99', {
    getHistoryLog: async () => {
      throw new Error('log missing');
    },
    getHistoryEval: async () => {
      throw new Error('eval missing');
    },
    getHistoryParamStats: async () => {
      throw new Error('paramStats missing');
    },
  });

  assert.deepEqual(result.epochs, []);
  assert.equal(result.evalData, null);
  assert.equal(result.paramHistory, null);
  assert.deepEqual(result.missing, ['log', 'eval', 'paramStats']);
});

test('loadTrainingRoundDetails flags paramStats only when other two succeed', async () => {
  const result = await loadTrainingRoundDetails('round_5', {
    getHistoryLog: async () => ({ round: 'round_5', epochs: [{ epoch: 1 }] as any }),
    getHistoryEval: async () => ({ model: 'round_5' }) as any,
    getHistoryParamStats: async () => null, // null = success but empty
  });

  // null 是 fulfilled，spec 上算"拿到了空数据"，不算 missing
  assert.equal(result.epochs.length, 1);
  assert.equal(result.evalData?.model, 'round_5');
  assert.equal(result.paramHistory, null);
  assert.deepEqual(result.missing, []);
});
