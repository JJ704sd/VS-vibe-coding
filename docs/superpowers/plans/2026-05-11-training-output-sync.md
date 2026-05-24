# Training Output Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse all ECGFounder training outputs into one backend API shape and surface the additional run metadata in the existing training dashboard.

**Architecture:** Keep file-system parsing inside `proxy-server/parsers.py`, with FastAPI routes in `proxy-server/main.py` continuing to expose `/api/training/history`, `/log`, `/eval`, and `/param-stats`. The React frontend consumes the same routes through `src/services/trainingApi.ts` and extends the existing `TrainingDashboard` table/modal.

**Tech Stack:** Python FastAPI sidecar, pytest backend tests, React 18 + TypeScript + Ant Design, Node test runner for frontend service tests.

---

### Task 1: Backend Parser Coverage

**Files:**
- Modify: `proxy-server/parsers.py`
- Test: `proxy-server/tests/test_training_output_parsers.py`

- [x] Write failing pytest coverage for CPSC `history_*.csv` + `summary_*.json`, MIT-BIH `test_evaluation_round_*.json`, and root `train_round_*.log` fallback parsing.
- [x] Run `python -m pytest tests/test_training_output_parsers.py -q` from `proxy-server` and confirm the new tests fail before implementation.
- [x] Add helpers that select latest matching files, safely parse floats/ints, count epochs, expose `best_epoch`, `best_auc`, `threshold`, `status`, and return a normalized synthetic evaluation when no test JSON exists.
- [x] Re-run the parser test file and confirm it passes.

### Task 2: API Shape Integration

**Files:**
- Modify: `proxy-server/main.py`
- Modify: `proxy-server/assistant/training_diagnostics.py`
- Test: `proxy-server/tests/test_training_diagnostics.py`

- [x] Ensure `/api/training/history` includes richer fields while preserving existing `round`, `number`, `dataset`, `best_f1`, `test_accuracy`, and `path`.
- [x] Keep `/api/training/history/{round}/log` and `/eval` backward-compatible.
- [x] Update diagnostics to tolerate non-`round_N` histories and missing metrics.
- [x] Run backend tests through `npm run test:backend`.

### Task 3: Frontend Types And Display

**Files:**
- Modify: `src/services/trainingApi.ts`
- Modify: `src/pages/TrainingDashboard.tsx`
- Test: `src/services/trainingApi.test.ts`

- [x] Extend `HistoryRound`, `EpochData`, and `EvaluationData` with optional metadata fields from the backend.
- [x] Update the history table to show source type, epochs, best epoch, AUC, threshold, and status without breaking older rows.
- [x] Update the detail modal to show summary/config/report-derived fields when present.
- [x] Run `npm run typecheck` and `npm run test:unit`.

### Task 4: Final Verification

**Files:**
- No additional files.

- [x] Run `npm run test:backend`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run test:unit`.
- [x] Inspect the diff and summarize changed files and verified commands.
