# shadcn Workspace Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the front end of the ECG workbench with a shadcn-style visual system while keeping the existing Ant Design + React architecture and focusing on the dashboard, case list, and annotation studio.

**Architecture:** Keep the current routing and data flow intact. Replace the global shell and shared CSS tokens first so the application gets one coherent visual language, then restyle the three core pages to use that shell and clearer card-based information hierarchy. Avoid reworking the business logic or the canvas/inference services.

**Tech Stack:** React 18, TypeScript, Ant Design, React Router, Redux Toolkit, CSS variables, existing local services and mock APIs.

---

### Task 1: Rebuild the shared application shell

**Files:**
- Modify: `src/components/Layout/MainLayout.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Review the current shell markup and identify the minimum structure needed for a shadcn-style app frame.**

```tsx
// Keep the route structure intact, but move to a lighter shell:
// - top bar with title, subtitle, and status pills
// - left nav with compact sections
// - content area with softer borders and more spacing
```

- [ ] **Step 2: Implement the shell update.**

```tsx
// MainLayout.tsx should keep using Ant Design Layout/Menu,
// but render a cleaner sidebar, a denser header, and a more neutral workspace frame.
```

- [ ] **Step 3: Replace the global palette and spacing tokens.**

```css
/* index.css should define:
   - neutral page background
   - card surfaces
   - border/ring colors
   - shadow levels
   - font tokens
   - shadcn-like button/input/card overrides
*/
```

- [ ] **Step 4: Run a focused build smoke check.**

Run: `npm run build`
Expected: webpack finishes successfully with exit code `0`.


### Task 2: Restyle the dashboard and case list

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/CaseList.tsx`

- [ ] **Step 1: Restructure the dashboard hero and summary blocks into calmer, higher-signal cards.**

```tsx
// Dashboard should emphasize:
// - one clear hero section
// - 4 concise KPI cards
// - recent activity as stacked rows
// - AI distribution and work rhythm in separate cards
```

- [ ] **Step 2: Refactor the case list page into a registry-like work surface.**

```tsx
// CaseList should keep the current search/create flows,
// but present them with clearer page grouping:
// - summary metrics
// - search and filters
// - table inside a strong card
// - right-sized empty/loading states
```

- [ ] **Step 3: Run a page-level visual sanity check through the build.**

Run: `npm run build`
Expected: no TypeScript or bundling regressions from the page refactor.


### Task 3: Upgrade the annotation studio information hierarchy

**Files:**
- Modify: `src/pages/AnnotationStudio.tsx`
- Modify: `src/components/Canvas/ECGCanvas.tsx` if small container tweaks are needed

- [ ] **Step 1: Identify the most visible control groups in the studio.**

```tsx
// Group the studio into:
// - import/source controls
// - annotation tools
// - inference/status area
// - playback and export actions
// - canvas workspace
```

- [ ] **Step 2: Re-layout the page with shadcn-style card sections and clearer hierarchy.**

```tsx
// Keep the existing data logic and hotkeys.
// Tighten the spacing, simplify labels, and make the canvas area feel primary.
```

- [ ] **Step 3: Verify the workspace still builds.**

Run: `npm run build`
Expected: successful production build.


### Task 4: Lightly harmonize adjacent screens

**Files:**
- Modify: `src/pages/CaseDetail.tsx`
- Modify: `src/pages/AIModels.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Apply the shared surface/card language to the remaining pages without changing behavior.**

```tsx
// These pages should reuse the updated card, spacing, and typography patterns,
// but avoid deeper behavioral changes.
```

- [ ] **Step 2: Check the route set still renders correctly.**

Run: `npm run build`
Expected: clean build and no broken imports.


### Task 5: Final verification

**Files:**
- No new files expected unless a small shared helper is extracted during implementation.

- [ ] **Step 1: Run the full verification command set.**

Run:
```bash
npm run build
npm run lint
```
Expected: both commands exit `0` with no new errors.

- [ ] **Step 2: Review the resulting diff for visual consistency and accidental behavior changes.**

```bash
git diff -- src
```

- [ ] **Step 3: Commit only after the build and lint checks are clean.**

```bash
git add src docs/superpowers/plans/2026-04-06-shadcn-workspace-refresh.md
git commit -m "feat: refresh ECG workspace visuals"
```
