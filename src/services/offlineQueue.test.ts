import assert from 'node:assert/strict';
import test from 'node:test';
import { syncPendingActions, type PendingAction } from './offlineQueue.ts';

const createAction = (id: string, type: PendingAction['type']): PendingAction => ({
  id,
  type,
  data: { id },
  timestamp: Date.now(),
});

test('syncPendingActions removes successful actions and keeps failed actions with error metadata', async () => {
  const create = createAction('create-1', 'create');
  const update = createAction('update-1', 'update');

  const result = await syncPendingActions([create, update], {
    create: async () => undefined,
    update: async () => {
      throw new Error('remote unavailable');
    },
  });

  assert.equal(result.synced.length, 1);
  assert.equal(result.synced[0].id, 'create-1');
  assert.equal(result.remaining.length, 1);
  assert.equal(result.remaining[0].id, 'update-1');
  assert.equal(result.remaining[0].retryCount, 1);
  assert.equal(result.remaining[0].lastError, 'remote unavailable');
});

test('syncPendingActions keeps actions when no executor exists for the action type', async () => {
  const action = createAction('delete-1', 'delete');

  const result = await syncPendingActions([action], {});

  assert.equal(result.synced.length, 0);
  assert.equal(result.remaining.length, 1);
  assert.equal(result.remaining[0].lastError, 'No sync handler configured for delete');
});
