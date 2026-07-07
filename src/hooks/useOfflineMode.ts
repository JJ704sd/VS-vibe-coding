import { useState, useEffect, useCallback } from 'react';
import { PendingAction, PendingActionExecutors, syncPendingActions } from '../services/offlineQueue';

interface UseOfflineModeOptions {
  /**
   * Map of action type → executor. C-19: without these the hook can never
   * actually drain the queue because `syncPendingActions` treats every
   * action as "no handler configured". Defaults to an empty map; the hook
   * still tracks pendingActions and online state, but `syncNow` will only
   * succeed when a caller passes real executors.
   */
  executors?: PendingActionExecutors;
}

interface UseOfflineModeReturn {
  isOnline: boolean;
  pendingActions: number;
  lastSyncTime: string | null;
  syncNow: () => Promise<void>;
  addPendingAction: (action: PendingAction) => void;
  clearPendingActions: () => void;
}

const STORAGE_KEY = 'ecg_platform_pending_actions';
const SYNC_TIME_KEY = 'ecg_platform_last_sync';

export function useOfflineMode(options: UseOfflineModeOptions = {}): UseOfflineModeReturn {
  const { executors = {} } = options;
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingActions, setPendingActions] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      console.log('[useOfflineMode] Back online');
    };

    const handleOffline = () => {
      setIsOnline(false);
      console.log('[useOfflineMode] Gone offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const actions = JSON.parse(stored);
        setPendingActions(actions.length);
      } catch (e: unknown) {
        console.error('[useOfflineMode] Failed to parse pending actions', e);
      }
    }

    const lastSync = localStorage.getItem(SYNC_TIME_KEY);
    if (lastSync) {
      setLastSyncTime(lastSync);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const savePendingActions = useCallback((actions: PendingAction[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
    setPendingActions(actions.length);
  }, []);

  const addPendingAction = useCallback((action: PendingAction) => {
    const stored = localStorage.getItem(STORAGE_KEY);
    let actions: PendingAction[] = [];
    if (stored) {
      try {
        actions = JSON.parse(stored) as PendingAction[];
      } catch (error) {
        console.error('[useOfflineMode] Failed to parse pending actions before append', error);
      }
    }
    actions.push(action);
    savePendingActions(actions);
  }, [savePendingActions]);

  const clearPendingActions = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setPendingActions(0);
  }, []);

  const syncNow = useCallback(async () => {
    if (!isOnline) {
      console.log('[useOfflineMode] Cannot sync while offline');
      return;
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    let actions: PendingAction[] = [];
    try {
      actions = JSON.parse(stored) as PendingAction[];
    } catch (error) {
      console.error('[useOfflineMode] Failed to parse pending actions before sync', error);
      return;
    }
    if (actions.length === 0) return;

    if (Object.keys(executors).length === 0) {
      // C-19: surface a single, visible warning instead of silently
      // re-marking every action as failed. Without this the user has no
      // signal that the hook is misconfigured.
      console.warn(
        '[useOfflineMode] syncNow called with no executors configured; ' +
          `${actions.length} pending action(s) will stay in localStorage. ` +
          'Pass `useOfflineMode({ executors: { create, update, delete } })` to enable real sync.',
      );
      return;
    }

    console.log('[useOfflineMode] Syncing pending actions:', actions.length);

    const result = await syncPendingActions(actions, executors);
    for (const action of result.synced) {
      console.log('[useOfflineMode] Synced action:', action.id);
    }
    for (const action of result.remaining) {
      console.error('[useOfflineMode] Failed to sync action:', action.id, action.lastError);
    }

    const now = new Date().toISOString();
    localStorage.setItem(SYNC_TIME_KEY, now);
    setLastSyncTime(now);
    if (result.remaining.length === 0) {
      clearPendingActions();
    } else {
      savePendingActions(result.remaining);
    }
  }, [isOnline, executors, clearPendingActions, savePendingActions]);

  return {
    isOnline,
    pendingActions,
    lastSyncTime,
    syncNow,
    addPendingAction,
    clearPendingActions
  };
}

export default useOfflineMode;
