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
