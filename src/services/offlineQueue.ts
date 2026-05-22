export interface PendingAction {
  id: string;
  type: 'create' | 'update' | 'delete';
  data: unknown;
  timestamp: number;
  retryCount?: number;
  lastError?: string;
}

export type PendingActionExecutor = (action: PendingAction) => Promise<void>;

export type PendingActionExecutors = Partial<Record<PendingAction['type'], PendingActionExecutor>>;

export interface SyncPendingActionsResult {
  synced: PendingAction[];
  remaining: PendingAction[];
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown sync error';

const markFailed = (action: PendingAction, error: unknown): PendingAction => ({
  ...action,
  retryCount: (action.retryCount || 0) + 1,
  lastError: getErrorMessage(error),
});

export async function syncPendingActions(
  actions: PendingAction[],
  executors: PendingActionExecutors
): Promise<SyncPendingActionsResult> {
  const synced: PendingAction[] = [];
  const remaining: PendingAction[] = [];

  for (const action of actions) {
    const executor = executors[action.type];
    if (!executor) {
      remaining.push(markFailed(action, new Error(`No sync handler configured for ${action.type}`)));
      continue;
    }

    try {
      await executor(action);
      synced.push(action);
    } catch (error) {
      remaining.push(markFailed(action, error));
    }
  }

  return { synced, remaining };
}
