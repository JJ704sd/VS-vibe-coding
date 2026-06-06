# Changelog

All notable changes to the ECG Annotation Platform are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- `webpack.config.js`: lifted performance budget to `maxEntrypointSize: 2 500 000`
  (2.5 MiB) and `maxAssetSize: 1 500 000` (1.5 MiB); flipped `hints` from
  `'warning'` to `'error'` so any future bundle regression surfaces as a CI
  failure rather than a yellow icon. Rationale + per-chunk breakdown lives
  inline in the file.

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
