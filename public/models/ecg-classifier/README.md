# ECG Model Placement Guide

**Default state (this repository): no real model is committed.** The build
artefact tree therefore contains only this `README.md` placeholder under
`dist/models/ecg-classifier/`, and the UI shows a permanent
"真实模型未配置" banner. AI analysis results come from the heuristic
`mockPredict` fallback and **must not be used for clinical decisions**.

To enable real inference:

Place your TensorFlow.js model files in this directory:

- `model.json`
- weight shard files referenced by `model.json` (for example `group1-shard1of1.bin`)

Expected runtime URL (served by the production bundle via `CopyWebpackPlugin`):

- `/models/ecg-classifier/model.json`

Quick verification steps:

1. `npm run build` — `dist/models/ecg-classifier/` should now contain your
   `model.json` and weight shards (in addition to this `README.md`,
   which `CopyWebpackPlugin` ignores).
2. Run `npm run check:assets` — the resource-existence script verifies
   `dist/index.html` plus `dist/models/ecg-classifier/model.json` exist
   on disk.
3. Start the app and open Annotation Studio.
4. Click **加载模型**.
5. If files are correct, you should see **真实模型加载成功** (no warning banner).
6. Click **AI 分析** to get model-driven predictions.

Notes:

- If model loading fails at runtime (404, network error, shape mismatch),
  the app falls back to `mockPredict` to keep core flows usable and the
  banner reappears.
- For best compatibility, provide a model expecting ECG-like tensors
  (common shapes include `[1, time, channels]` or `[1, channels, time]`).
- Do **not** commit real model weights larger than a few hundred KiB to
  this repository. Use Git LFS, a CDN, or download them at build time.
