# ECG Annotation & Analysis Platform

Web-based ECG annotation and analysis demo built with React, TypeScript, Ant Design, TensorFlow.js, and Fabric.js.

## What it does

- Import ECG data from `JSON`, `DICOM`, `HL7`, and `WFDB` files
- Import MIT-BIH style paired records from `.hea` + `.dat`
- Pull JSON data from a GitHub Raw URL
- Switch between `P`, `Q`, `R`, `S`, `T`, `ST`, `U` annotations on the waveform canvas (full `Annotation['type']` union; UI exposes all 7 buttons)
- Run local AI inference or optional Minimax-assisted analysis
- Export the current record as `JSON` or `CSV`

## Quick Start

```bash
npm install
npm run start
```

Open `http://localhost:3000/` in your browser.

ECGFounder 答辩/演示启动说明（Sidecar、runner、observer 和预检命令）见 [docs/demo-startup.md](docs/demo-startup.md)。

## Build

```bash
npm run build
```

## Main Screens

- Dashboard: overall system overview
- Case List: patient browsing and case entry
- Case Detail: record preview and diagnosis timeline
- Annotation Studio: import, annotate, analyze, and export ECG data
- AI Models: local model management demo
- Settings: UI and inference preferences

## Notes

This repository is currently optimized for demo and workflow validation. Some screens still use mock data, and the DICOM / HL7 / WFDB parsers are intentionally lightweight.

### Demo / non-clinical boundary

This project is a **research preview**, not a medical device.

- **Patient data** is sourced from a 20-record PTB-XL backup embedded in `src/data/mockClinic.ts`. Real deployments must swap this for a clinical data source behind the same `clinicApi.ts` interface.
- **AI inference** in `modelService.ts` falls back to `mockPredict(...)` when no TF.js LayersModel is loaded. The accuracy numbers shown on the `AI Models` page are mock; the underlying model URL is `/models/ecg-classifier/model.json` and must be replaced with a validated `.pth` / TF.js bundle. Exported JSON / CSV carry `diagnosis.source: 'real' | 'mock' | 'unavailable'` (see `src/utils/buildDiagnosis.ts`) so downstream consumers can tell heuristic fallback outputs from real TF.js runs.
- **Sidecar** (`proxy-server/main.py`) is bound to `localhost` and reads from the local `D:/ECG founder/ECGFounder` training workspace by default; the path is overridable via `ECGFOUNDER_BASE`.
- **Assistant** (memory + RAG) writes to `proxy-server/assistant_memory.json`; nothing leaves the machine.
- **CORS** for the sidecar is restricted to the local dev origins by default (`SIDECAR_ALLOW_ORIGINS` env var).

In the UI, every page surfaces a yellow **Non-clinical preview** banner at the top (`src/components/DemoBanner.tsx`), the sidebar carries a `Demo / Mock` mode tag, the `AI Models` page marks each entry with an orange `MOCK` chip, and the `Annotation Studio` AI results card now renders a persistent orange `MOCK` chip whenever `modelService.isUsingMockInference()` is true (so the heuristic-vs-real boundary survives after the post-load toast disappears).

## Project Structure

- `public/` static entry files
- `src/pages/` application pages
- `src/components/` shared UI components
- `src/services/` parsing and model services
- `src/utils/` signal processing and export helpers
- `src/store/` Redux state

## Tests

```bash
# Frontend unit tests (Node built-in test runner, no Jest)
npm run test:unit

# Backend pytest (proxied via npm script so CI and dev use the same path)
npm run test:backend

# One-shot quality gate: lint + typecheck + unit tests + production build
npm run check
```

See `docs/demo-startup.md` for end-to-end demo checks (preflight, sidecar, runner, observer).

## Version

- `v1.0.0`
