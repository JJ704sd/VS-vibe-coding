# Lightweight ECG Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a low-risk assistant for case Q&A, knowledge retrieval, and current annotation explanation.

**Architecture:** Keep the current FastAPI assistant endpoints and React side panel. Add deterministic backend answer composition for the current case snapshot, keep RAG retrieval for project docs, and add a fallback markdown knowledge file when repository docs are missing.

**Tech Stack:** Python FastAPI sidecar, pytest, React 18, TypeScript, Ant Design.

---

### Task 1: Backend Assistant Behavior

**Files:**
- Modify: `proxy-server/assistant/service.py`
- Modify: `proxy-server/assistant/rag_store.py`
- Test: `proxy-server/tests/test_assistant_service.py`

- [x] Add failing pytest coverage for annotation explanation from the request context.
- [x] Add failing pytest coverage for fallback knowledge indexing when README, SPEC, and docs markdown are absent.
- [x] Implement deterministic current-case answer text and source synthesis.
- [x] Implement fallback knowledge document creation under `docs/assistant/knowledge-base.md`.
- [x] Run `npm run test:backend`.

### Task 2: Frontend Panel Polish

**Files:**
- Modify: `src/pages/components/SmartAssistancePanel.tsx`
- Modify: `src/services/ecgAssistantApi.ts`

- [x] Replace mojibake UI strings with readable Chinese labels and errors.
- [x] Add quick question buttons for current annotation explanation, AI result interpretation, WFDB import help, and signal quality.
- [x] Keep all assistant actions explicit and read-only.
- [x] Run `npm run lint` and `npm run typecheck`.

### Task 3: Final Verification

- [x] Run focused backend tests.
- [x] Run TypeScript checks.
- [x] Run lint if time permits.
- [x] Summarize changed files and any remaining risk.
