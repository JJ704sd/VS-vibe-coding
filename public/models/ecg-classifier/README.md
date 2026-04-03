# ECG Model Placement Guide

Place your TensorFlow.js model files in this directory:

- `model.json`
- weight shard files referenced by `model.json` (for example `group1-shard1of1.bin`)

Expected runtime URL:

- `/models/ecg-classifier/model.json`

Quick verification steps:

1. Start app and open Annotation Studio.
2. Click **加载模型**.
3. If files are correct, you should see **真实模型加载成功**.
4. Click **AI 分析** to get model-driven predictions.

Notes:

- If model loading fails, the app falls back to mock inference to keep core flows usable.
- For best compatibility, provide a model expecting ECG-like tensors
  (common shapes include `[1, time, channels]` or `[1, channels, time]`).
