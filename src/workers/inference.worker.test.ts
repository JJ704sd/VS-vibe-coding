// Tests for the `inference.worker.ts` message protocol (Track M, audit A-10).
//
// Background: the worker used to handle a `predictWithHeatmap` message
// that first emitted `{ type: 'prediction' }` and then a separate
// `{ type: 'heatmap' }` message. No main-thread code ever consumed
// the heatmap response, and the main thread had no caller for the
// combined message, so the branch was both wrong (orphan heatmap) and
// dead code. The fix removed the message type entirely.
//
// We can't construct a real `tf.LayersModel` under Node, so the
// protocol-level tests below focus on the static contract: the
// worker file's switch statement must handle exactly the supported
// message types and must NOT handle `predictWithHeatmap`. The other
// regression we pin is that `generateHeatmap` was removed alongside
// the dead branch — so it can never reappear in a future commit.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKER_PATH = fileURLToPath(
  new URL('../workers/inference.worker.ts', import.meta.url),
);

function readWorkerSource(): string {
  return readFileSync(WORKER_PATH, 'utf8');
}

// Strip line comments so the worker file's audit-fix header
// (which references the removed function by name) does not trip
// the "is the function gone?" check.
function stripComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('inference.worker message protocol (audit A-10)', () => {
  it("does NOT handle the dead 'predictWithHeatmap' message", () => {
    const code = stripComments(readWorkerSource());
    assert.equal(
      code.includes("'predictWithHeatmap'"),
      false,
      "inference.worker.ts must not handle 'predictWithHeatmap' — the message had no caller and produced an orphan heatmap response (audit A-10).",
    );
    assert.equal(
      code.includes('"predictWithHeatmap"'),
      false,
      "inference.worker.ts must not handle 'predictWithHeatmap' (double-quoted variant) — audit A-10.",
    );
  });

  it("does NOT contain a 'heatmap' postMessage response (the dead branch's orphan)", () => {
    const code = stripComments(readWorkerSource());
    // The dead code emitted `{ type: 'heatmap', heatmap: ... }`. After
    // the fix, the worker no longer posts any 'heatmap' messages.
    assert.equal(
      code.includes("type: 'heatmap'") || code.includes('type: "heatmap"'),
      false,
      "inference.worker.ts must not post '{ type: 'heatmap' }' — audit A-10 removed the dead branch.",
    );
  });

  it('does NOT contain the unused generateHeatmap helper', () => {
    const code = stripComments(readWorkerSource());
    assert.equal(
      code.includes('generateHeatmap'),
      false,
      'inference.worker.ts must not define generateHeatmap — it was only used by the dead predictWithHeatmap branch (audit A-10).',
    );
  });

  it('still handles the supported message types: loadModel, predict, dispose', () => {
    const code = stripComments(readWorkerSource());
    assert.ok(code.includes("'loadModel'"), 'must still handle loadModel');
    assert.ok(code.includes("'predict'"), 'must still handle predict');
    assert.ok(code.includes("'dispose'"), 'must still handle dispose');
  });

  it('emits { type: "prediction" } and { type: "error" } responses', () => {
    const code = stripComments(readWorkerSource());
    assert.ok(
      code.includes("type: 'prediction'") || code.includes('type: "prediction"'),
      'must still emit prediction results',
    );
    assert.ok(
      code.includes("type: 'error'") || code.includes('type: "error"'),
      'must still emit error results',
    );
    assert.ok(
      code.includes("type: 'modelLoaded'") || code.includes('type: "modelLoaded"'),
      'must still emit modelLoaded acknowledgements',
    );
  });
});
