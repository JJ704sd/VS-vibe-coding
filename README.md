# ECG Annotation & Analysis Platform

Web-based ECG annotation and analysis demo built with React, TypeScript, Ant Design, TensorFlow.js, and Fabric.js.

## What it does

- Import ECG data from `JSON`, `DICOM`, `HL7`, and `WFDB` files
- Import MIT-BIH style paired records from `.hea` + `.dat`
- Pull JSON data from a GitHub Raw URL
- Switch between `P`, `R`, and `T` annotations on the waveform canvas
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
