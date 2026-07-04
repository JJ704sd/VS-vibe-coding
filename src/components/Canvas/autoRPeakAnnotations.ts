// Pure helper that turns R-peak sample indices into lead-aware annotations.
//
// Lives next to the canvas geometry helpers in `constants.ts` because both
// piece of code share the same single source of truth (canvas width /
// height, lead band maths). Kept as a standalone module — not inside the
// AnnotationStudio component file — so that the Node test runner can call
// it without spinning up React / Fabric / antd and without the Fabric 5.x
// `window.document` crash under bare Node.
//
// Why this exists:
//   Before the fix, AnnotationStudio.handleAutoDetectRPeaks built each
//   annotation as `{ position, x, confidence, manual, timestamp, ... }`
//   and never set `y`. ECGCanvas.renderAnnotationObjects falls back to
//   `annotation.y ?? 0` for legacy / imported records, so the auto R-peak
//   marker landed at y=0 (top of the canvas) instead of on the waveform
//   band of the active lead. Recomputing y via
//   `computeCanvasPointForSample` keeps the marker aligned with the same
//   polyline the canvas renders for that lead.

import { Annotation, ECGLead } from '../../types';
import {
  computeCanvasPointForSample,
  ECG_CANVAS_DEFAULT_HEIGHT,
  ECG_CANVAS_VIEW_WIDTH,
} from './constants';

/**
 * Cap matching AnnotationStudio's previous `peaks.slice(0, 250)` to keep
 * pathological records (e.g. 30 minutes of dense noise) from parking 10k
 * Fabric circles on the canvas.
 */
const AUTO_R_PEAK_MAX_COUNT = 250;

/**
 * Build auto R-peak annotations for the given lead set.
 *
 * Returns an empty array when no peaks are detected (the caller is
 * responsible for surfacing the user-facing `未检测到 R 峰` warning).
 *
 * The returned annotation always carries `y`, computed against the active
 * lead's band, so the rendering canvas does NOT fall back to y=0.
 */
export function buildAutoRPeakAnnotations(
  leads: ECGLead[],
  leadName: string,
  threshold: number,
  findRPeaks: (data: number[], threshold: number) => number[],
  options: {
    canvasWidth?: number;
    canvasHeight?: number;
    maxCount?: number;
    now?: number;
  } = {},
): Annotation[] {
  if (leads.length === 0) {
    return [];
  }

  const canvasWidth = options.canvasWidth ?? ECG_CANVAS_VIEW_WIDTH;
  const canvasHeight = options.canvasHeight ?? ECG_CANVAS_DEFAULT_HEIGHT;
  const maxCount = options.maxCount ?? AUTO_R_PEAK_MAX_COUNT;
  const now = options.now ?? Date.now();

  const matched = leads.find((lead) => lead.name === leadName);
  const lead = matched ?? leads[0];
  const leadIndex = leads.findIndex((candidate) => candidate.name === lead.name);
  const safeLeadIndex = leadIndex >= 0 ? leadIndex : 0;

  const peaks = findRPeaks(lead.data, threshold);
  return peaks.slice(0, maxCount).map((sampleIndex) => {
    const { x, y } = computeCanvasPointForSample({
      sampleIndex,
      lead,
      leadIndex: safeLeadIndex,
      leadCount: leads.length,
      canvasWidth,
      canvasHeight,
    });
    return {
      id: `auto_r_${lead.name}_${sampleIndex}`,
      type: 'R',
      position: x,
      x,
      y,
      confidence: 0.75,
      manual: false,
      timestamp: now,
    };
  });
}
