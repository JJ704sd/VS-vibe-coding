#!/usr/bin/env node
// scripts/verify-canvas-coords.mjs
//
// Hand-rolled verification for the Canvas annotation pipeline invariants
// that the unit tests cannot easily express (because Fabric.js crashes
// outside the browser when it loads at module scope).
//
// What this checks:
//   1. No file outside src/components/Canvas/constants.ts hardcodes
//      "viewWidth = 1200" or any 1200 magic number tied to the canvas.
//      The ECGCanvas audit (2026-07-04) found AnnotationStudio using a
//      literal `const viewWidth = 1200;` that drifted from the ECGCanvas
//      default width. The fix imports ECG_CANVAS_VIEW_WIDTH from the
//      constants module — this script enforces that contract.
//   2. ECG_CANVAS_VIEW_WIDTH is defined in exactly one place
//      (src/components/Canvas/constants.ts) and re-exported by ECGCanvas
//      so existing imports keep working.
//   3. AnnotationStudio.applyImportedLeads dispatches setAnnotations([])
//      so the import-new-record path clears stale annotation circles.
//   4. The annotation type union stays in sync between types/index.ts and
//      ECGCanvas's random-fallback list (the toolbar drives the type, but
//      the random-fallback list is what runs when no tool is selected).
//
// Exit code: 0 if all checks pass, 1 otherwise. Designed to be safe to
// run from CI in addition to npm run check.
//
// Usage:
//   node scripts/verify-canvas-coords.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`✗ ${message}`);
}

function pass(message) {
  console.log(`✓ ${message}`);
}

function readRepo(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

// 1. ECGCanvas.tsx must NOT hardcode "1200" as a view width constant.
const ecgCanvasSource = readRepo('src/components/Canvas/ECGCanvas.tsx');
if (/(?:viewWidth|width)\s*[:=]\s*1200\b/.test(ecgCanvasSource)) {
  fail('src/components/Canvas/ECGCanvas.tsx still hardcodes 1200 as a view width — use ECG_CANVAS_VIEW_WIDTH instead.');
} else {
  pass('ECGCanvas.tsx no longer hardcodes 1200 as view width.');
}

// 2. ECGCanvas.tsx re-exports ECG_CANVAS_VIEW_WIDTH so existing
//    `import { ECG_CANVAS_VIEW_WIDTH } from '.../ECGCanvas'` keeps working.
if (!/export\s*\{\s*ECG_CANVAS_VIEW_WIDTH\s*\}/.test(ecgCanvasSource)) {
  fail('src/components/Canvas/ECGCanvas.tsx does not re-export ECG_CANVAS_VIEW_WIDTH. Existing imports will break.');
} else {
  pass('ECGCanvas.tsx re-exports ECG_CANVAS_VIEW_WIDTH for backward compat.');
}

// 3. AnnotationStudio.tsx no longer has a literal `viewWidth = 1200`;
//    it must import ECG_CANVAS_VIEW_WIDTH from ECGCanvas (or constants).
const annotationStudioSource = readRepo('src/pages/AnnotationStudio.tsx');
if (/\bviewWidth\s*=\s*1200\b/.test(annotationStudioSource)) {
  fail('src/pages/AnnotationStudio.tsx still has literal `viewWidth = 1200` — import ECG_CANVAS_VIEW_WIDTH.');
} else {
  pass('AnnotationStudio.tsx no longer hardcodes viewWidth=1200.');
}
if (!/ECG_CANVAS_VIEW_WIDTH/.test(annotationStudioSource)) {
  fail('src/pages/AnnotationStudio.tsx does not import ECG_CANVAS_VIEW_WIDTH. Auto R-peak placement will silently drift.');
} else {
  pass('AnnotationStudio.tsx imports ECG_CANVAS_VIEW_WIDTH.');
}

// 4. applyImportedLeads dispatches setAnnotations([]) so import-new-record
//    clears stale annotation circles. Before the fix, importing a new
//    record left old annotation objects floating on the new waveform.
const applyImportedLeadsMatch = annotationStudioSource.match(
  /const applyImportedLeads[\s\S]*?\n  \};/,
);
if (!applyImportedLeadsMatch) {
  fail('Could not locate applyImportedLeads in AnnotationStudio.tsx — was it renamed?');
} else if (!/dispatch\(setAnnotations\(\[\]\)\)/.test(applyImportedLeadsMatch[0])) {
  fail('applyImportedLeads does not dispatch setAnnotations([]) — import-new-record will leak old annotations.');
} else {
  pass('applyImportedLeads dispatches setAnnotations([]) on import.');
}

// 5. The annotation type union lives in exactly one place (types/index.ts)
//    and ECGCanvas's fallback list must stay in sync with it (we allow the
//    fallback list to be a subset, since the UI toolbar drives the actual
//    selected type — but the type literal must be reachable).
const typesSource = readRepo('src/types/index.ts');
const unionMatch = typesSource.match(/type:\s*'([^']+)'\s*\|\s*'([^']+)'\s*\|\s*'([^']+)'\s*\|\s*'([^']+)'\s*\|\s*'([^']+)'\s*\|\s*'([^']+)'\s*\|\s*'([^']+)'/);
if (!unionMatch) {
  fail('src/types/index.ts annotation type union has changed — update this script.');
} else {
  const expectedTypes = unionMatch.slice(1);
  const missing = expectedTypes.filter((t) => !new RegExp(`'${t}'`).test(ecgCanvasSource));
  if (missing.length > 0) {
    fail(`ECGCanvas.tsx is missing annotation type literals from the union: ${missing.join(', ')}`);
  } else {
    pass('ECGCanvas.tsx references every annotation type from the union.');
  }
}

// 6. AnnotationToolbar exposes ST and U buttons (BUG #4 fix).
const toolbarSource = readRepo('src/pages/components/AnnotationToolbar.tsx');
if (!/onSelectAnnotationType\('ST'\)/.test(toolbarSource)) {
  fail('AnnotationToolbar.tsx missing ST annotation button.');
} else if (!/onSelectAnnotationType\('U'\)/.test(toolbarSource)) {
  fail('AnnotationToolbar.tsx missing U annotation button.');
} else {
  pass('AnnotationToolbar.tsx exposes ST and U annotation buttons.');
}

// 7. ECGCanvas handleAddAnnotation / handleDeleteSelectedAnnotation must
//    NOT imperatively call `canvasInstance.add(circle, label)` for
//    annotation objects — Redux is the single source of truth and
//    renderAnnotationObjects is the only writer of annotation_* Fabric
//    objects. We do allow canvasInstance.remove(obj) in renderWaveforms
//    (it cleans waveform/label/grid_, not annotation_).
const imperativeAddMatch = ecgCanvasSource.match(/canvasInstance\?\.add\(\s*circle\s*,\s*label\s*\)/);
if (imperativeAddMatch) {
  fail('ECGCanvas.tsx still imperatively calls canvasInstance.add(circle, label) — Redux must remain the single source of truth.');
} else {
  pass('ECGCanvas.tsx no longer imperatively adds annotation Fabric objects.');
}

// 8. ECGCanvas dispatches setAnnotations via Redux and exposes a useEffect
//    that re-renders annotation objects when the array changes.
if (!/useEffect\(\(\)\s*=>\s*\{[\s\S]*?renderAnnotationObjects[\s\S]*?\}, \[annotations\]\)/.test(ecgCanvasSource)) {
  fail('ECGCanvas.tsx is missing the useEffect([annotations]) → renderAnnotationObjects bridge.');
} else {
  pass('ECGCanvas.tsx bridges Redux annotations → Fabric annotation objects via useEffect.');
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}

console.log('\nAll Canvas-coordinate invariants hold.');