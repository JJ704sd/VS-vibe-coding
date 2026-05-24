# Training Agent Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only training diagnosis agent to the training dashboard.

**Architecture:** Add deterministic training diagnosis logic in the FastAPI sidecar and expose it through `/api/assistant/training/diagnose`. Add matching TypeScript API types and a compact React panel inside the training dashboard live view.

**Tech Stack:** Python FastAPI sidecar, pytest, React 18, TypeScript, Ant Design.

---

### Task 1: Backend Training Diagnosis

**Files:**
- Create: `proxy-server/assistant/training_diagnostics.py`
- Modify: `proxy-server/main.py`
- Test: `proxy-server/tests/test_training_diagnostics.py`

- [x] Add failing tests for idle-state diagnosis and overfitting/gradient-risk diagnosis.
- [x] Implement deterministic diagnosis rules with health status, summary, recommendations, and evidence.
- [x] Add a sidecar route that reads current training state, param stats, and history rounds.
- [x] Run `npm run test:backend`.

### Task 2: Frontend Training Agent Panel

**Files:**
- Modify: `src/services/trainingApi.ts`
- Create: `src/pages/components/TrainingAgentPanel.tsx`
- Modify: `src/pages/TrainingDashboard.tsx`

- [x] Add TypeScript types and API client for `/api/assistant/training/diagnose`.
- [x] Add a read-only panel with generate/refresh diagnosis, health status, recommendations, and evidence.
- [x] Place the panel in the live training dashboard without changing training controls.
- [x] Run `npm test`, `npm run typecheck`, and `npm run lint`.

### Task 3: Full Verification

- [x] Run backend tests.
- [x] Run frontend unit tests.
- [x] Run production build.
- [x] Summarize backend and frontend sync points.
