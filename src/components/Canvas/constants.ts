// Shared constants for the Canvas annotation pipeline.
//
// Lives in its own file (no React / Fabric / antd imports) so that pure-logic
// tests — e.g. findRPeaks + auto-R-peak viewWidth math — can import
// `ECG_CANVAS_VIEW_WIDTH` without dragging Fabric.js into the test runtime
// (Fabric 5.x accesses `window.document` at module load time and crashes
// under bare Node even when happy-dom is installed, because the timing of
// global setup vs. CJS module evaluation varies across environments).
//
// Annotation.position is stored in this logical canvas width (canvas px
// before any viewport transform). Consumers that need to map a sample
// index back to canvas x MUST use this constant — hardcoded 1200 will
// silently drift the day ECGCanvas's default width changes.

export const ECG_CANVAS_VIEW_WIDTH = 1200;