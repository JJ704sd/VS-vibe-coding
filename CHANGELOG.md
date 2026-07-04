# Changelog

All notable changes to the ECG Annotation Platform are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The 2026-07-04 P0 audit + Canvas closeout round. Eight commits: one docs
rewrite, one test infrastructure scaffold, one boundary-case test, two
follow-up commits already shipped in 0.2.0 (kept here for traceability),
two P0 bug fixes, and one audit closeout doc.

### Added
- **`copy-webpack-plugin` for production builds**: `webpack.config.js`
  and `webpack.config.dev.js` now run `CopyWebpackPlugin` against
  `public/models/**` so the TensorFlow.js model directory is shipped
  to `dist/models/` (and therefore to GitHub Pages). `public/models/`
  currently only ships the README placeholder; real `model.json` +
  weight shards are intentionally NOT committed.
- **`scripts/check-build-assets.js`** post-build resource check: hard
  fails on missing `dist/`, `dist/index.html`, `dist/models/`,
  `dist/models/ecg-classifier/`; soft warns on missing
  `dist/models/ecg-classifier/model.json` (the documented default state).
  Pass `--strict` to flip the soft warn into a hard failure once a real
  model is shipped. Wired into `npm run check` after `npm run build` and
  also exposed as a standalone `npm run check:assets` / `npm run build:check`.
- **"真实模型未配置" UI banner** (`AIAnalysisPanel` + `AnnotationStudio`):
  when `modelService.isUsingMockInference()` is true, the panel now
  surfaces a permanent warning Alert explaining that AI results come from
  the heuristic `mockPredict` fallback and are not suitable for clinical
  use. The "AI 分析" button label also switches to "AI 分析 (模拟)" so
  reviewers cannot mistake mock output for real model predictions.
- **Unit tests for `scripts/check-build-assets.js`** (7 cases, all green):
  complete dist/ tree, missing model.json in non-strict mode (warn),
  missing model.json in strict mode (fail), missing dist/models/
  (fail — the regression that motivated this round), missing dist/
  itself (fail), soft-spec missing file (warn), directory entry count
  in detail line.

### Added
- **Canvas coordinate invariant** (`46dc5d1 refactor(canvas)`): the shared
  constant `ECG_CANVAS_VIEW_WIDTH` lives in
  `src/components/Canvas/constants.ts`; ECGCanvas default width and the
  auto R-peak position calculation both consume it so the literal `1200`
  no longer drifts between modules.
- **Happy-DOM e2e test scaffolding** (`acbf4f0 chore(test)` + `6c7387e
  chore(test)`): happy-dom is wired into the Node test runner so UI
  rendering assertions can run without a real browser. `npm run test:unit`
  now also covers `src/__tests__/annotationWorkflow.test.tsx` (import →
  load model → annotate → delete → export).
- **P0 audit documents** (`c487669 docs(audit)`):
  - `AUDIT-2026-07-04-model-canvas.md` — five-axis risk register
    (real model / cache / mock fallback / demo data / lightweight parser)
    with R-01..R-25 entries.
  - `docs/superpowers/plans/2026-07-04-canvas-annotation-audit.md` —
    Canvas annotation chain review with C-01..C-07 entries.
  - `docs/superpowers/plans/2026-07-04-bug-audit-and-closeout-checklist.md`
    — top-level checklist + per-BUG records.

### Changed
- **`webpack.config.js`** (`8762264 chore(build)`, kept here for trace):
  lifted performance budget to `maxEntrypointSize: 2 500 000` (2.5 MiB)
  and `maxAssetSize: 1 500 000` (1.5 MiB); flipped `hints` from
  `'warning'` to `'error'` so any future bundle regression surfaces as a CI
  failure rather than a yellow icon.
- **`CLAUDE.md` / `AGENTS.md`** (`099f594 docs`): rewritten to remove
  duplication. CLAUDE.md now owns task routing, command cheatsheet,
  debugging cookbook, and the env-vars single source of truth. AGENTS.md
  owns generic contributor rules (project layout, coding style, testing,
  commit / PR, security). Both files headlined `最近更新:2026-07-04`.
- **`REVIEW.md`** (`c487669`): added a `2026-07-04 P0 audit + canvas
  closeout round` section, moved prior `2026-06-06 hardening round`
  description into a comparative block, retagged risk #1 / #6 / #7 as
  closed, demoted risk #5 to partially mitigated, kept risk #8 (ECGFounder
  external PR) unchanged.

### Fixed
- **Cross-record annotation contamination (C-01)** (`46dc5d1`):
  `AnnotationStudio.applyImportedLeads` now dispatches
  `setAnnotations([])` so importing a new record drops stale annotation
  circles from the previous record.
- **AnnotationToolbar missing ST / U buttons (C-03)** (`46dc5d1`):
  the UI now exposes all seven `Annotation['type']` buttons
  (`P` / `Q` / `R` / `S` / `T` / `ST` / `U`) instead of only three.
- **Annotation `x` field inconsistency (C-04)** (`46dc5d1`): both the
  double-click handler and the auto R-peak handler now write
  `position` and `x` together; `renderAnnotationObjects` reads
  `annotation.x ?? annotation.position` for backwards compatibility.
- **Redux / Fabric dual-track annotations (C-05)** (`46dc5d1`):
  `ECGCanvas.handleAddAnnotation` and
  `ECGCanvas.handleDeleteSelectedAnnotation` now only dispatch. A new
  `useEffect([annotations])` + `renderAnnotationObjects` derives Fabric
  objects from Redux so the two state tracks never desync.
- **`diagnosis.source` provenance (BUG-2026-07-04-1 / R-01, P0)**
  (`10df188 fix(export)`): new pure helper
  `src/utils/buildDiagnosis.ts` resolves
  `(inferenceResults, isUsingMockInference, heartRate)` into
  `{ label, confidence, source: 'real' | 'mock' | 'unavailable' }`.
  `ECGRecord.diagnosis` carries an optional `source` field, JSON exports
  pass it through verbatim, and CSV exports write a
  `Source,<real|mock|unavailable>` row immediately after the `Confidence`
  row (omitted when `source` is absent so older fixtures stay intact).
- **Persistent MOCK chip on AI results (BUG-2026-07-04-2 / R-02, P0)**
  (`180be1e fix(ui)`): `SignalMetrics` now takes an optional
  `isUsingMockInference?: boolean` prop and renders an orange
  `MOCK` tag with `data-testid="mock-inference-chip"` next to the
  existing `Results` tag in the `AI 诊断结果` card's `extra` area.
  `AnnotationStudio` passes `modelService.isUsingMockInference()` so the
  chip follows the model's actual state instead of the post-load toast
  that times out after a few seconds.

### Test
- **`src/utils/buildDiagnosis.test.ts`** (`10df188`, 6 tests):
  real / mock / top-prediction / HR-fallback / empty + mock-flag /
  unavailable branches.
- **`src/utils/exportUtils.test.ts`** (`10df188`, +7 tests): JSON
  `source` passthrough (real / mock / unavailable) + CSV `Source` row
  behaviour + backwards-compat when `source` is absent.
- **`src/pages/components/SignalMetrics.test.tsx`** (`180be1e`, 5 tests):
  MOCK chip presence / absence / default / result-list regression /
  `Results` tag preserved.
- **`src/store/ecgSlice.test.ts`** (`46dc5d1`, 9 tests): annotation
  lifecycle (`setAnnotations([])` / `addAnnotation` /
  `removeAnnotation` / `clearECG`).
- **`src/utils/signalProcessor.findRPeaks.test.ts`** (`46dc5d1`, 7 tests):
  R-peak detection incl. `ECG_CANVAS_VIEW_WIDTH` integration + boundary
  pins (e.g. `threshold=0` returns no peaks).
- **`src/__tests__/annotationWorkflow.test.tsx`** (`46dc5d1`): e2e
  smoke for the annotation workflow under happy-dom.

### Verification
- `npm run lint` — 0 errors
- `npm run typecheck` — 0 errors
- `npm run test:unit` — **109/109 pass** (新增 36,既有 73)
- `npm run build` — webpack compiled successfully, no size warnings
  (`performance.hints: 'error'` enforces 2.5 MiB entrypoint budget)
- `npm run check` — full gate green
- `node scripts/verify-canvas-coords.mjs` — 9/9 Canvas-coordinate
  invariants hold
- `git diff --check` — 0 exit

## [0.2.0] - 2026-06-06

The 2026-06-06 hardening round. Five feature / fix commits followed by
three follow-up commits (CI fix, docs, engine pin) and an empty re-trigger
commit to publish the site.

### Added
- **Continuous integration** (`6c9d019 chore(ci)`): rewrote
  `.github/workflows/deploy-pages.yml` to listen on `main` and `pull_request`,
  split the run into `quality` (lint + typecheck + 49 frontend unit tests +
  30 backend pytest), `build` (webpack production + Pages artifact), and
  `deploy` (`actions/deploy-pages@v4`). The new `proxy-server/requirements.txt`
  lets CI install the FastAPI / sse-starlette / filelock stack before pytest.
- **Runtime config via environment** (delivered in `a17fbec feat(env)`,
  documented in this release): `CLINIC_API_BASE_URL`,
  `TRAINING_API_BASE_URL`, `ASSISTANT_API_BASE_URL`, and `ANALYZE` are now
  read from `.env` (dev) or the shell (prod) through `dotenv-webpack` and
  `webpack.DefinePlugin`, with a `localhost` fallback baked into
  `src/config/env.ts` so the demo keeps booting without an env file.
- **`CHANGELOG.md`** (this file).

### Fixed
- **CORS allow-list** (`c7328a5 fix(sidecar)`): `proxy-server/main.py` now
  reads `SIDECAR_ALLOW_ORIGINS` (defaults to the local dev servers) instead
  of the previous `allow_origins=["*"]`. Any future deployment that exposes
  the sidecar beyond localhost has to set the env var explicitly.
- **DELETE confirmation** (`c7328a5 fix(sidecar)`):
  `DELETE /api/training/history/{round_name}` now requires
  `?confirm=<round_name>` to match the round name, so a stray request can
  no longer remove a training round without echoing it back.
- **`run_platform.bat` env var** (`17967a9 fix(tools)`): now reads
  `ECGFOUNDER_BASE` from the environment (Windows default fallback kept for
  the demo) and forwards it to the sidecar so the batch file and
  `proxy-server/state.py` agree on the ECGFounder repo location.
- **CI Node version** (`4fdbd60 fix(ci)`): bumped `actions/setup-node` from
  Node 20 to Node 22 LTS, then (`b334c7d fix(ci)`) to Node 24 with a
  `NODE_OPTIONS=--max-old-space-size=6144` cap on the unit-tests step, so
  `--experimental-strip-types` no longer OOMs the 7 GiB runner when loading
  the 49 frontend tests in shared process isolation.
- **Engine pin** (`304e13f chore`): `package.json` now declares
  `engines.node: ">=22.6.0"`, matching the actual CI runner and surfacing
  a warning on local installs that are too old.

### Changed
- **`.gitignore`** (`edda1ac chore(repo)`): ignores `.mavis/`, `.opencode/`,
  and `.worktrees/` so local tooling state does not pollute `git status`.
- **Docs sync** (`edda1ac chore(repo)`): `CLAUDE.md` and `README.md` now
  describe the Node built-in test runner (the previous "Jest" wording was
  stale) and point readers at `npm run test:backend` as the canonical
  pytest entry point.
- **`REVIEW.md`** (`0842ed5 docs`): updated to the post-merge state with a
  "2026-06-06 hardening round" section mapping the 5 hardening commits
  back to the 8 risks flagged on 2026-05-26.

### Infrastructure
- **Site deployed**: `https://jj704sd.github.io/VS-vibe-coding/` is live as
  of 2026-06-06T04:13:21Z (run `a0bc4fe`).

## [0.1.0] - 2026-05-26

The 2026-05 hardening round (`PR #11` and earlier): aligned
`proxy-server/main.py`, `state.py`, `parsers.py`, the training API, and the
frontend training dashboard with the ECGFounder training contract; added
partial-success loading to `TrainingDashboard` detail popup; added a view
model and tests for `ParamStatsPanel` when the gradient checkpoint stats
are missing; clarified CPSC / PTB-XL validation-derived metric provenance;
shipped the Chinese-language preflight script and demo-startup doc; moved
the ECGFounder param-observer fix to its own branch on the external
`JJ704sd/ECGFounder` repo.

[Unreleased]: https://github.com/JJ704sd/VS-vibe-coding/compare/304e13f...HEAD
[0.2.0]: https://github.com/JJ704sd/VS-vibe-coding/compare/004f61a...304e13f
[0.1.0]: https://github.com/JJ704sd/VS-vibe-coding/compare/previous...004f61a
