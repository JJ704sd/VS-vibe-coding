import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { act, renderHook } from '@testing-library/react';
import { useOfflineMode } from './useOfflineMode.ts';
import type { PendingAction } from '../services/offlineQueue.ts';

// happy-dom's Window exposes localStorage on `window.localStorage`, but
// `scripts/test-setup.mjs` does not mirror it onto globalThis. Production
// code (`useOfflineMode`) reads `localStorage` as a bare global, so do the
// same here for a faithful test environment without touching shared setup.
if (typeof globalThis.localStorage === 'undefined' && typeof window !== 'undefined') {
  // Node 22+ makes some globals read-only; defineProperty is the safe path.
  Object.defineProperty(globalThis, 'localStorage', {
    value: window.localStorage,
    writable: true,
    configurable: true,
  });
}

// Force navigator.onLine=true so the hook's syncNow path doesn't bail out
// at the "Cannot sync while offline" early-return. Node 22's built-in
// navigator is the one used here (happy-dom's Window doesn't replace it),
// and its onLine can be false depending on the runner's environment.
Object.defineProperty(
  typeof navigator !== 'undefined' ? navigator : globalThis,
  'onLine',
  { value: true, writable: true, configurable: true },
);

const STORAGE_KEY = 'ecg_platform_pending_actions';
const SYNC_TIME_KEY = 'ecg_platform_last_sync';

const makeAction = (id: string, type: PendingAction['type'] = 'create'): PendingAction => ({
  id,
  type,
  data: { id },
  timestamp: Date.now(),
});

const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SYNC_TIME_KEY);
});

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SYNC_TIME_KEY);
});

test('syncNow without executors leaves pending actions untouched and only warns (C-19)', async () => {
  const { result } = renderHook(() => useOfflineMode());

  act(() => {
    result.current.addPendingAction(makeAction('a-1'));
  });
  assert.equal(result.current.pendingActions, 1);

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: string) => warnings.push(String(msg));
  try {
    await act(async () => {
      await result.current.syncNow();
      await flushMicrotasks();
    });
  } finally {
    console.warn = originalWarn;
  }

  // The C-19 fix: warn the operator, do NOT silently mark every action as
  // failed and re-save it. Pending actions should still be in localStorage
  // so the operator can fix the wiring without losing queued work.
  assert.equal(result.current.pendingActions, 1);
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, 'a-1');
  assert.equal(stored[0].retryCount, undefined);
  assert.ok(
    warnings.some((w) => w.includes('no executors configured')),
    `expected a no-executors warning, got: ${warnings.join('\n')}`,
  );
});

test('syncNow with executors drains the queue and updates lastSyncTime', async () => {
  const executed: string[] = [];
  const { result } = renderHook(() =>
    useOfflineMode({
      executors: {
        create: async (action) => {
          executed.push(action.id);
        },
      },
    }),
  );

  act(() => {
    result.current.addPendingAction(makeAction('a-1'));
    result.current.addPendingAction(makeAction('a-2'));
  });
  assert.equal(result.current.pendingActions, 2);

  await act(async () => {
    await result.current.syncNow();
    await flushMicrotasks();
  });

  assert.deepEqual(executed.sort(), ['a-1', 'a-2']);
  assert.equal(result.current.pendingActions, 0);
  assert.equal(localStorage.getItem(STORAGE_KEY), null);
  assert.ok(result.current.lastSyncTime, 'lastSyncTime should be set after a successful sync');
  assert.equal(localStorage.getItem(SYNC_TIME_KEY), result.current.lastSyncTime);
});

test('syncNow keeps actions whose executor throws and surfaces the lastError', async () => {
  const { result } = renderHook(() =>
    useOfflineMode({
      executors: {
        create: async () => {
          throw new Error('remote 503');
        },
      },
    }),
  );

  act(() => {
    result.current.addPendingAction(makeAction('a-1'));
  });

  await act(async () => {
    await result.current.syncNow();
    await flushMicrotasks();
  });

  assert.equal(result.current.pendingActions, 1);
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, 'a-1');
  assert.equal(stored[0].retryCount, 1);
  assert.equal(stored[0].lastError, 'remote 503');
});

test('clearPendingActions wipes localStorage and resets the count', () => {
  const { result } = renderHook(() => useOfflineMode());

  act(() => {
    result.current.addPendingAction(makeAction('a-1'));
  });
  assert.equal(result.current.pendingActions, 1);

  act(() => {
    result.current.clearPendingActions();
  });
  assert.equal(result.current.pendingActions, 0);
  assert.equal(localStorage.getItem(STORAGE_KEY), null);
});
