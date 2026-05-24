# History Training Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only history training agent to rank past training rounds, detect anomalies, and suggest the next training direction.

**Architecture:** Add deterministic history analysis rules in the FastAPI sidecar and expose them through `/api/assistant/training/history/diagnose`. Add matching TypeScript types/API and a compact React panel above the history training table.

**Tech Stack:** Python FastAPI sidecar, pytest, React 18, TypeScript, Ant Design.

---

### Task 1: Backend History Diagnosis

**Files:**
- Modify: `proxy-server/assistant/training_diagnostics.py`
- Modify: `proxy-server/main.py`
- Test: `proxy-server/tests/test_training_diagnostics.py`

- [x] Add failing tests for best-round ranking, trend detection, and anomalous rounds.
- [x] Implement deterministic history analysis with summary, best round, trend, anomalies, recommendations, and ranked rounds.
- [x] Add a sidecar route that reads history rounds and returns the analysis.
- [x] Run `npm run test:backend`.

### Task 2: Frontend History Agent Panel

**Files:**
- Modify: `src/services/trainingApi.ts`
- Create: `src/pages/components/HistoryTrainingAgentPanel.tsx`
- Modify: `src/pages/TrainingDashboard.tsx`

- [x] Add TypeScript types and API client for `/api/assistant/training/history/diagnose`.
- [x] Add a read-only panel with analyze button, best round, trend, anomalies, ranked rounds, and recommendations.
- [x] Place it above the history table in the `历史训练记录` tab.
- [x] Run `npm test`, `npm run typecheck`, and `npm run lint`.

### Task 3: Full Verification

- [x] Run backend tests.
- [x] Run frontend tests.
- [x] Run production build.
- [x] Summarize frontend/backend sync points.
