// Shared constants and pure-geometry helpers for the Canvas annotation
// pipeline.
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

/**
 * Default canvas height passed to ECGCanvas from AnnotationStudio
 * (matches the `height={520}` prop on line 883). Consumers without access
 * to ECGCanvas's props fall back to this value when computing lead-aware
 * annotation y coordinates.
 */
export const ECG_CANVAS_DEFAULT_HEIGHT = 520;

export interface LeadLike {
  data: number[];
}

/**
 * Compute the height of a single lead band inside a canvas of
 * `canvasHeight` px. Matches `ECGCanvas.renderWaveforms` exactly.
 */
export function computeLeadBandHeight(canvasHeight: number, leadCount: number): number {
  return canvasHeight / Math.max(1, leadCount);
}

/**
 * Compute the amplitude scale used to map a raw sample value to a canvas
 * pixel offset. Matches `ECGCanvas.renderWaveforms` exactly: the scale
 * keeps the lead's largest absolute swing at ~34% of its band height.
 * `maxAbs` falls back to 0.01 on silent leads (same as the canvas) so the
 * math stays stable and never divides by zero.
 */
export function computeAmplitudeScale(lead: LeadLike, leadBandHeight: number): number {
  let maxAbs = 0.01;
  for (let i = 0; i < lead.data.length; i += 1) {
    const abs = Math.abs(lead.data[i]);
    if (abs > maxAbs) maxAbs = abs;
  }
  return (leadBandHeight * 0.34) / maxAbs;
}

export interface CanvasPointOptions {
  sampleIndex: number;
  lead: LeadLike;
  leadIndex: number;
  leadCount: number;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Map a sample index in a lead to canvas (x, y) using exactly the same
 * geometry `ECGCanvas.renderWaveforms` uses for polyline plotting. Callers
 * generating annotations without a pointer event (e.g. auto R-peak
 * detection in `AnnotationStudio.handleAutoDetectRPeaks`) use this so the
 * annotation circle lands on the actual waveform instead of the canvas
 * top.
 *
 * `sampleIndex` is interpreted against the current `lead.data` length; if
 * it is out of range, `value` is treated as 0 (y = bandCenter), matching
 * how the canvas handles missing samples via `lead.data[i] ?? 0` in the
 * caller (kept identical here for symmetry).
 */
export function computeCanvasPointForSample(opts: CanvasPointOptions): { x: number; y: number } {
  const { sampleIndex, lead, leadIndex, leadCount, canvasWidth, canvasHeight } = opts;

  const leadBandHeight = computeLeadBandHeight(canvasHeight, leadCount);
  const amplitudeScale = computeAmplitudeScale(lead, leadBandHeight);
  const centerOffset = leadBandHeight / 2;
  const yOffset = leadIndex * leadBandHeight + centerOffset;

  const x = (sampleIndex / Math.max(1, lead.data.length - 1)) * canvasWidth;
  const value = sampleIndex >= 0 && sampleIndex < lead.data.length ? lead.data[sampleIndex] : 0;
  const y = yOffset - value * amplitudeScale;

  return { x, y };
}
