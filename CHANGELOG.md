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
  tightened performance budget to `maxEntrypointSize: 1 600 000`
  (1.5 MiB + ~50 KiB headroom) and `maxAssetSize: 1 500 000` (1.5 MiB);
  flipped `hints` from `'warning'` to `'error'` so any future bundle
  regression surfaces as a CI failure rather than a yellow icon.
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
  (`performance.hints: 'error'` enforces 1.5 MiB entrypoint budget)
- `npm run check` — full gate green
- `node scripts/verify-canvas-coords.mjs` — 9/9 Canvas-coordinate
  invariants hold
- `git diff --check` — 0 exit

### Added (2026-07-07 batch 1+2 P1 closeout round)
- **`scripts/check-bundle-budget-sync.ps1`** (`b995732 fix(build)`,
  D-3 cherry-pick): PowerShell script that reads `maxEntrypointSize` /
  `maxAssetSize` from `webpack.config.js` (single source of truth),
  computes the matching decimal / thin-space / `MiB` forms, greps
  `REVIEW.md` and `CHANGELOG.md` for the current value (must appear)
  and a hard-coded list of stale byte / MiB values from the prior
  round (must NOT appear), and exits 1 with a diff list if the docs
  drift away from the config. Wired in CI / preflight to prevent the
  next round of REVIEW-vs-webpack drift.

### Changed (2026-07-07 batch 1+2 P1 closeout round)
- **`webpack.config.js` / `webpack.config.dev.js`** (`b995732`,
  D-4 cherry-pick): `performance.assetFilter` added so async chunks
  (`firebase` / `tensorflow` / `echarts` / `antd`) are subject to
  `maxAssetSize` enforcement alongside the entrypoint. Previously
  webpack only warned on non-entry assets even with `hints: 'error'`,
  so a vendor split could silently grow past the budget.

### Fixed (2026-07-07 batch 1+2 P1 closeout round)
> See `docs/audits/2026-07-07-FINAL-REPORT.md` for the full risk
> register (5 P0 + 23 P1 + 20 P2 + 6 P3 = 54 findings). This round
> closes **all 5 P0** and **11 of 23 P1** from that audit; the other
> **12 P1 + 20 P2 + 6 P3** stay open and feed the next round.

**P0 (5/5 closed):**
- **A-01 DICOM parser explicit VR** (`b61340c fix(parser)`): the
  parser no longer hard-codes implicit VR little endian at offset
  132. It now detects `Explicit VR Little Endian` / `Explicit VR Big
  Endian` via `(0002,0000)` Group-Length + `OB / OW / SQ` transfer
  syntax table and routes waveform Sequence reads accordingly, so
  real-world DICOM files with explicit VR or big-endian headers
  parse correctly.
- **A-03 WFDB `Uint8Array` + `212` format** (`b61340c`): the parser
  no longer round-trips raw bytes through `TextDecoder` (which
  silently corrupts high-byte samples). It now reads `Uint8Array`
  directly, swaps endianness per-record, and supports the MIT-BIH
  `212` packed format alongside `212` / `16` / `16+212`.
- **C-12 MiniMax proxy route** (`80e55c5 fix(sidecar)`):
  `proxy-server/main.py` now exposes `POST /api/minimax/analyze`
  and the frontend `minimaxService` resolves through it by default,
  removing the 404 path that the previous `useProxy=false` fallback
  was trying to work around.
- **D-1 Sidecar path traversal** (`80e55c5`): the
  `download_checkpoint` and `list_checkpoints` handlers now run
  `round_name` and `filename` through `_safe_round_name` +
  `^[A-Za-z0-9_.\-]+\.pth$` regex, and verify the resolved path is
  a child of `ECGFOUNDER_OUTPUTS.resolve()` via `is_relative_to`
  before `FileResponse`. A regression test in
  `proxy-server/tests/test_training_api_contract.py` covers
  `../etc/passwd`, absolute paths, and non-`.pth` filenames.
- **D-2 Sidecar admin token** (`80e55c5`): destructive routes
  (`POST /api/training/task`, `POST /api/training/stop`,
  `DELETE /api/training/history/{round_name}`) now require an
  `X-Admin-Token` header matching `SIDECAR_ADMIN_TOKEN`. Token is
  read from env (random `uuid4` generated on first boot if unset)
  and logged once at startup. Non-destructive `GET` endpoints stay
  open for the local-dev / GitHub-Pages demo boundary.

**P1 closed (11/23):**
- **A-02 DICOM waveform tags** (`c7faa32 fix(parser)`):
  `(5400,0100) WaveformSequence` traversal now extracts per-channel
  sample count + bit depth + interleaving, not just the raw 132-byte
  sample window.
- **A-04 HL7 sampling / duration** (`c7faa32`): MSH-OBX pipeline
  parses `OBX-5` numerics + `OBX-3` units (`ms` / `mV` / `uV`) and
  the matching `OBR-7` observation datetime so sample rate and
  duration are extracted from the message instead of being hard
  coded to 500 Hz / 10 s.
- **A-05 `.hl7` UI route** (`c7faa32`): the Annotation Studio file
  picker now recognises `.hl7` (alongside `.json` / `.dcm` /
  `.hea`/`.dat`) and dispatches `parseHL7Pipeline` through the
  same `importECGRecord` flow.
- **B-03 URL switch state reset** (`c779107` + `575f360`):
  `AnnotationStudio` now has a `useEffect` keyed on `patientId` /
  `recordId` that guards `setAnnotations` / `setLeads` against the
  ref-stale branch; switching to another record resets both stores
  and clears the Fabric selection.
- **B-04 Firebase debounce guard** (`c779107`): `firebaseService`
  exposes a single in-flight `writeAnnotations` promise; concurrent
  calls await the existing promise instead of issuing overlapping
  `updateDoc`s that overwrote each other on rapid edits.
- **B-05 import clears stale inference** (`c779107`):
  `AnnotationStudio.applyImportedLeads` now also dispatches
  `clearECG()`'s inference slice, so importing a new record drops
  the previous AI results card (not just the canvas).
- **C-11 `useProxy=false` 直连分支下架** (`80e55c5`):
  `minimaxService` no longer ships the `useProxy=false` 直连分支
  (SSRF + API-key 外发风险), 前端强制走 Sidecar 代理。
- **C-14 HL7 padding / endian** (`c7faa32`): `atob` chain now
  strips `=` padding and applies endianness per `OBR-8` bit-order
  field instead of assuming little-endian on every run.
- **C-15 WFDB `parseECG` entry** (`c7faa32`): `src/utils/dicomParser`
  now exposes a `parseECG({ wfdb: { header, dat } })` entry point
  so the WFDB path is wired into `importECGRecord` the same way
  DICOM / HL7 are.
- **D-3 bundle budget doc sync** (`b995732`): see Added section —
  the doc-vs-config drift is now script-enforced.
- **D-4 async chunk assetFilter** (`b995732`): see Changed section —
  vendor splits can no longer grow past the budget silently.

**P1 still open (12/23) — feeds the next round:**
- **A-06 / A-07 / A-08 / A-09 / A-10 / A-12 / A-14** (7 items,
  Track M scope): model contract / cache namespace / tensor
  pre-processing / sigmoid-vs-softmax / heatmap worker protocol /
  multi-lead mock fallback. No commits landed in this round;
  the planned Track M worker session produced no reachable
  artifacts (see Risks section below).
- **B-06 / B-07** (2 items, Track F scope): `firebaseService
  .initialize()` failure swallowed by `console.warn` + `updateDoc`
  failures returned silently — no toast / user feedback. No commits
  landed in this round; same as Track M.
- **C-06 / C-07 / C-19** (3 items, Track C residuals): RAG store
  fallback writes to `docs/assistant/knowledge-base.md`; assistant
  error responses leak absolute file paths; `useOfflineMode
  .syncNow` has an empty executor.

### Risks and known gaps
- **Track M / Track F worker loss**: the batch-2 plan reported
  `Track M (model contract)` and `Track F (firebase UX)` as merged,
  but `git cat-file -t 5e8e9b0` / `d2f3a51` returned "Not a valid
  object name" and no dangling commits exist for them either.
  Work was either never produced or silently dropped. Re-spawn
  these workers in the next round, ideally with explicit
  pre-merge verification (a `git log fix/track-<id>` check) per
  the "team plan killed ≠ not done" SOP.
- **D-3 cherry-pick**: the Track D2 commit (`d33a348`) was
  recoverable as a dangling commit, so D-3 and D-4 were salvaged
  here. Without that dangling commit the round would have closed
  9 P1 instead of 11.

### Verification (2026-07-07 round)
- `npm run lint` — 0 errors
- `npm run typecheck` — 0 errors
- `npm run test:unit` — **207/208 pass** (1 pre-existing skip)
- `npm run test:backend` — green
- `npm run build` — webpack compiled successfully, no size warnings
  (`hints: 'error'` + `assetFilter` both enforce)
- `npm run check:assets` — 0 fail (production build artefact check
  still passes after the `assetFilter` change)
- `pwsh scripts/check-bundle-budget-sync.ps1` — exits 0 (this
  commit keeps `REVIEW.md` / `CHANGELOG.md` consistent with
  `webpack.config.js` 1 600 000 entrypoint + 1 500 000 asset budgets)
- `git diff --check` — 0 exit

### Added (2026-07-07 batch 3 P1 closeout round)
> Closes **9 P1** from the 2026-07-07 audit (23 P1 → 14 P1 remaining).
> Final state on main: **5 P0 + 20 P1 + 0 P2 + 0 P3 closed**.
> Remaining: **3 P1 + 20 P2 + 6 P3** feed future rounds.
> 246/247 unit tests pass (was 207 before batch 3; +39 tests).

- **`ModelLoadOutcome` 显式三态契约** (`7deacab fix(model)`,
  A-06): `ModelService.loadModel` returns `{ outcome: 'loaded' |
  'mock' | 'failed', cacheWriteFailed, error? }`. Default outcome is
  `'failed'`, never silently degrades. UI must call
  `modelService.useMockInference()` to opt into mock mode. Existing
  `buildDiagnosis` `unavailable` state now covers the failed path
  end-to-end.
- **`pickDominantLead` 多导联选择** (`7deacab`, A-12): new exported
  pure helper picks the lead with the largest peak-to-peak amplitude.
  `mockPredict`, `generateHeatmap`, and `useModelInference.predict`
  all consume it instead of hardcoding `signal[0]`. A zero/empty
  first lead no longer hides signal in other leads.
- **`normalizeToProbabilities` sigmoid vs softmax 显式分支**
  (`7deacab`, A-09): takes an `outputActivation: 'softmax' |
  'sigmoid'` argument. Sigmoid outputs clamp to `[0, 1]` per label,
  never sum-to-1. Exposed via `ModelService.setOutputActivation()`.
- **共享 `MODEL_CACHE_NAMESPACE`** (`7deacab`, A-08): exported
  from `modelService.ts`. `useModelInference` imports it so hook
  and service share a single IndexedDB key namespace (was: disjoint
  `'ecg-hook-model-'` vs `'ecg-model-cache-'` buckets).
- **cache save failure fail-safe** (`7deacab`, A-07): cache save is
  a separate try/catch after the in-memory model is assigned.
  `QuotaExceededError` or any save failure logs a warning and sets
  `cacheWriteFailed=true`; the in-memory model stays usable until
  next cold start.
- **Worker `predictWithHeatmap` dead code 移除** (`7deacab`, A-10):
  the orphan `{ type: 'heatmap' }` postMessage branch had no caller
  and produced messages after the prediction promise had already
  resolved. Removed along with the unused `generateHeatmap` helper;
  3 protocol tests pin against re-introduction.
- **`buildInputTensor` hook 复用** (`7deacab`, A-14):
  `useModelInference`'s main / cache `predict()` path now calls the
  shared `ModelService.buildInputTensor` helper (was
  `tf.tensor3d([signal])` — shape-incompatible with time-major and
  4D conv heads).
- **Firebase init 失败用户反馈** (`8a911bb fix(studio)`, B-06):
  `firebaseService` exposes `setOnInitFailure(listener)` and
  `getLastInitError()`. `AnnotationStudio` registers a listener on
  mount that surfaces both a top-level `<Alert type="error">` and
  a `message.error()` toast when init fails (was: `console.warn`
  swallowed, 0 user feedback). Listener detaches on unmount.
- **Cloud save 失败用户反馈 + 防抖** (`8a911bb`, B-07):
  `saveAnnotationsToFirebase` now wraps `updateDoc` in try/catch;
  failures emit `message.error('云端保存失败: ...')`. A `useRef`
  5-second debounce window prevents a 1Hz save loop that fails 50
  times in a row from spamming 50 toasts.

### Changed (2026-07-07 batch 3 P1 closeout round)
- **`AnnotationStudio.handleModelLoad`** (`7deacab`, A-06
  companion change): no longer flips to mock mode on a silent
  `console.warn`. Now reads `ModelLoadOutcome`, shows a
  `Modal.confirm` when the real model is missing asking the user
  to opt in to mock. User-declined path stays in `unavailable`
  state for downstream `diagnosis.source: 'unavailable'` exports.
- **`AnnotationStudio` Firebase init banner** (`8a911bb`, B-06
  companion change): page-level red `<Alert>` is mounted when
  `firebaseService.getLastInitError()` is non-null on mount OR
  when the listener fires after init. The Alert is dismissible;
  the underlying state still drives the failure flag for downstream
  code paths.

### Risks and known gaps (batch 3)
- **Worker session timeout → salvage pattern**: both Track M and
  Track F worker sessions exceeded the 15-minute engine cap (with
  full lint + typecheck + test + build cycle on Windows). Track M
  managed to `git commit` pre-kill (commit `7deacab`); Track F had
  pending uncommitted changes that orchestrator committed on its
  behalf as `8a911bb` per memory SOP "team plan killed ≠ 没完成 +
  salvage uncommitted work". Lesson for future rounds: workers
  on Windows with the full `npm run check` cycle need either
  `--extend-timeout` to 25-30 min OR split the work into smaller
  PRs so each fits in the cap. See `MEMORY.md` "Worker timeout +
  salvage" entry.
- **AnnotationStudio.tsx 双向修改合并**: Track M (line 643+ A-06
  opt-in modal) and Track F (lines 136+ / 410+ B-06/B-07 alert +
  save error toast) both modified this file. Auto-merge with
  `ort` strategy resolved cleanly — no manual conflict markers
  required. Both feature areas are in non-overlapping code paths.
- **C-residuals 残留 3 项 P1 仍 open**: C-06 (RAG store fallback
  writes to `docs/assistant/knowledge-base.md`), C-07 (assistant
  error response leaks absolute file paths), C-19
  (`useOfflineMode.syncNow` empty executor). Need a separate round.

### Verification (2026-07-07 batch 3 round)
- `npm run lint` — 0 errors
- `npm run typecheck` — 0 errors
- `npm run test:unit` — **246/247 pass** (1 pre-existing skip;
  was 207 before batch 3 → +39 tests across Track M + Track F)
- `npm run build` — webpack compiled successfully, 1.5 MiB
  entrypoint, no size warnings (`hints: 'error'` + `assetFilter`
  both enforce after `b995732` cherry-pick from batch 2)
- `npm run check:assets` — 0 fail
- `pwsh scripts/check-bundle-budget-sync.ps1` — exits 0
- `git diff --check` — 0 exit
- `git log` — main ahead by 4 commits from `acffecf` (batch 1+2
  closeout base):
  - `7deacab fix(model): A-06..A-14 (7 P1)` — Track M
  - `e1863e4 merge: Track M`
  - `8a911bb fix(studio): B-06/B-07 (2 P1)` — Track F
  - `bba5196 merge: Track F`

### Added (2026-07-07 batch 4 C-residuals P1 closeout round)
> Closes the last **3 P1** from the 2026-07-07 audit (23 P1 → 20 P1 closed in
> batch 3 → 23 P1 closed in batch 4). Final state on main: **5 P0 + 23 P1 + 0
> P2 + 0 P3 closed**. Remaining: **20 P2 + 6 P3 = 26** feed future rounds.
> 250/251 unit tests pass (was 246 before batch 4; +4 useOfflineMode tests).

- **RAG fallback directory is now configurable and defaults to the sidecar
  data dir** (`fix(assistant)` (`37498b6`), C-06): `RAGStore.__init__`
  takes a `fallback_dir: Path | str | None` argument. The default
  `DEFAULT_FALLBACK_DIR` is computed as
  `proxy-server/.data/assistant/` (sibling of the sidecar, not under the
  repo) so a long-running process can never accidentally `git status`-pollute
  `<repo>/docs/assistant/knowledge-base.md`. The `rebuild()` fallback now
  writes to `self.fallback_dir` instead of `repo_root / "docs" / "assistant"`,
  and a new regression test pins the contract that the repo working tree
  stays clean even when no docs are present.
- **Assistant error responses no longer leak absolute paths**
  (`fix(assistant)` (`37498b6`), C-07): the per-file `errors[]` entries
  surfaced to the API caller now carry only `{filename, code}` where `code`
  is the exception class name (e.g. `PermissionError`, `IsADirectoryError`).
  The full absolute path and the raw exception message still go to the
  sidecar log (`assistant.rag_store` logger, WARNING level) so operators
  can debug, but never cross the API boundary. The audit-identified
  `attack scenario where a frontend user enumerates the repo layout from
  an error message` is now closed end-to-end.
- **`useOfflineMode` accepts a real `executors` map** (`fix(hook)`
  (`01f51b9`), C-19): the hook now takes an optional
  `{ executors?: PendingActionExecutors }` argument. Without executors the
  hook's `syncNow` short-circuits with a single, visible `console.warn`
  explaining how to enable real sync, instead of silently re-marking every
  action as failed. Business modules that want real offline replay can
  pass `useOfflineMode({ executors: { create, update, delete } })`. The
  behavior of an executor that throws is preserved (action is kept with
  `retryCount++` and `lastError` populated, never lost).

### Changed (2026-07-07 batch 4 round)
- **`RAGStore`** (`fix(assistant)`): signature now reads
  `RAGStore(repo_root, fallback_dir=None)`. `main.py:68` keeps the existing
  one-argument call (`RAGStore(REPO_ROOT)`) — the new param defaults to
  `proxy-server/.data/assistant/` so the sidecar boots identically. The
  in-process `tests/test_assistant_service.py` regression test was updated
  to monkey-patch `DEFAULT_FALLBACK_DIR` to a `tmp_path` and assert the
  repo working tree stays clean, instead of the old (now-obsolete) assertion
  that the file lands in `tmp_path / docs / assistant / knowledge-base.md`.
- **`useOfflineMode` return shape**: unchanged. The new `options` parameter
  is additive and optional — `useOfflineMode()` still works (it just won't
  drain the queue without executors wired up, which is the C-19 design
  intent: a hook that's never wired up is no worse than before, a hook
  that's wired up is finally usable).

### Risks and known gaps (batch 4)
- **P2 + P3 backlog remains**: 20 P2 + 6 P3 = 26 items still open from the
  2026-07-07 audit (e.g. C-08 assistant error response loses root cause,
  C-16/17/18 httpClient stability, C-20–C-22 training dashboard error
  surfaces, B-08–B-12 demo / build / docs hygiene, D-5–D-16 sidecar / CI
  hygiene). None of them are P0 or P1; the project can ship a release
  candidate from `main` once the deployment pre-reqs (sidecar admin token,
  CORS, real TF.js model) are in place.
- **`useOfflineMode` still has no production caller**. The hook is now
  correctly designed to be called with `executors`, but no component in
  `src/` passes them today. This is a deliberate scope cut: C-19 was the
  "hook shape" risk, not the "no caller exists" risk (the latter is a
  product decision that belongs in a follow-up round, not in a P1
  closeout).
- ~~**Sidecar data dir lifecycle**: `proxy-server/.data/assistant/` is
  created on first `rebuild()` when no docs are present. The directory is
  not gitignored today (the repo does not yet have a `.data` ignore rule
  for it). For a real deployment the operator should either:
  (1) ship a pre-populated knowledge base in the sidecar data dir and
      disable the fallback write, or
  (2) add `proxy-server/.data/` to `.gitignore` and accept the runtime
      write on first use. The batch 5 closeout will pick the right
      answer once product decides whether the sidecar is single-tenant
      demo or multi-tenant production.~~ — **2026-07-07 batch 5 校正**:
  经 `git blame .gitignore` + `git check-ignore -v` 实证,该条为误报。
  `.gitignore` line 19 自 `22cdf3b` (2026-05-23, Codex hardening round)
  已包含 `proxy-server/.data/`,C-06 fallback 默认目录
  `proxy-server/.data/assistant/` 一直在 ignored 集合内,`git status`
  不会污染。无需新 ignore 规则,无需 batch 5 决策。REVIEW.md 同步
  校正 §batch 4 round / 风险 #10 / 本轮整理 / 建议下一步 #10。

### Verification (2026-07-07 batch 4 round)
- `npm run lint` — 0 errors
- `npm run typecheck` — 0 errors
- `npm run test:unit` — **250/251 pass** (1 pre-existing skip; was 246
  before batch 4; +4 useOfflineMode tests covering C-19: no-executors
  warn, executors drain, executor throw → keep with lastError, clear
  pending actions)
- `npm run test:backend` — **74 passed** (was 30 before batch 1+2 +
  batch 3 round; +5 RAG tests covering C-06 fallback dir + C-07
  sanitized errors + the existing fallbacks; the 1 obsolete test in
  `test_assistant_service.py` was updated to assert the new contract)
- `npm run build` — webpack compiled successfully, 1.5 MiB entrypoint,
  no size warnings (`hints: 'error'` + `assetFilter` both enforce after
  the `b995732` cherry-pick)
- `npm run check:assets` — 0 fail
- `pwsh scripts/check-bundle-budget-sync.ps1` — exits 0
- `git diff --check` — 0 exit
- `npm run check` (combined) — 0 errors across lint / typecheck /
  test:unit / build / check:assets

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
