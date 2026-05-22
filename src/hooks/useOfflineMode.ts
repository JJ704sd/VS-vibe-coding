import { useState, useEffect, useCallback } from 'react';
import { PendingAction, syncPendingActions } from '../services/offlineQueue';

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

export function useOfflineMode(): UseOfflineModeReturn {
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

    console.log('[useOfflineMode] Syncing pending actions:', actions.length);

    const result = await syncPendingActions(actions, {});
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
  }, [isOnline, clearPendingActions, savePendingActions]);

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
