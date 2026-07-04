// Pure helper that derives a `record.diagnosis` object with an explicit
// provenance marker (`source`). Without it, an exported JSON / CSV file can
// carry a mock-style probability (e.g. "0.92 房颤") with no way for downstream
// consumers to tell whether it came from the real TF.js model or from
// `ModelService.mockPredict` (the heuristic std/mean/amplitude fallback).
//
// Why a pure helper:
//   The call site (`AnnotationStudio.handleExportCurrentRecord`) needs to
//   thread `modelService.isUsingMockInference()` into the diagnosis object.
//   Mounting the React component just to test that branch is heavyweight and
//   pulls in Fabric.js / happy-dom. Extracting the branch into a pure function
//   keeps the fix verifiable with a plain `node:test`.

import type { ModelPrediction } from '../types';

export type DiagnosisSource = 'real' | 'mock' | 'unavailable';

export interface BuiltDiagnosis {
  label: string;
  confidence: number;
  source: DiagnosisSource;
}

export interface BuildDiagnosisInput {
  inferenceResults: ModelPrediction[];
  isUsingMockInference: boolean;
  /** Resolved heart rate in bpm. `null` means "no signal / unable to derive". */
  heartRate: number | null;
}

/**
 * Resolve what `record.diagnosis` should look like for an export.
 *
 * Rules (mirrors `AnnotationStudio.handleExportCurrentRecord`):
 *   - No inference results → fallback label is either `HR <n> bpm` (when a
 *     heart rate can be derived from features) or `未分析`. Either way
 *     `source: 'unavailable'` because nothing the model produced went in.
 *   - Inference results present → label / confidence come from the top
 *     prediction. `source` is `mock` when the model service is in mock
 *     fallback mode, otherwise `real`.
 */
export function buildDiagnosis(input: BuildDiagnosisInput): BuiltDiagnosis {
  if (input.inferenceResults.length === 0) {
    return {
      label: input.heartRate !== null ? `HR ${input.heartRate} bpm` : '未分析',
      confidence: 0.5,
      source: 'unavailable',
    };
  }

  const top = input.inferenceResults[0];
  return {
    label: top.className,
    confidence: top.probability,
    source: input.isUsingMockInference ? 'mock' : 'real',
  };
}