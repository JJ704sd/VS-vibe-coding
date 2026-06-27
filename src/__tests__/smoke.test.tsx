// Minimal happy-path test for the e2e test scaffolding introduced in
// Phase 0 (see .planning/ui-e2e-coverage/task_plan.md). It exercises the
// full pipeline — happy-dom global setup, ts-resolver .tsx transpile,
// @testing-library/react render — without touching any production code.
// If this test ever fails, the e2e machinery itself is broken and the
// other e2e suites will not be reliable.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

// React 18's act() requires this flag for non-DOM test runners.
assert.equal((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT, true);

function Hello({ name }: { name: string }) {
  return React.createElement('h1', { 'data-testid': 'greeting' }, `Hello, ${name}!`);
}

test('react-testing-library renders tsx components under happy-dom', () => {
  const { getByTestId } = render(React.createElement(Hello, { name: 'ECG' }));
  assert.equal(getByTestId('greeting').textContent, 'Hello, ECG!');

  // Sanity-check that happy-dom actually installed a document.
  assert.equal(typeof globalThis.document, 'object');
  assert.equal(typeof globalThis.document.createElement, 'function');
  assert.equal(globalThis.document.body.contains(getByTestId('greeting')), true);

  cleanup();
});

test('screen queries work for rendered text', () => {
  render(
    React.createElement(
      'div',
      null,
      React.createElement('p', null, 'Phase 0 smoke'),
    ),
  );
  // getByText throws if not found, so reaching this line means it passed.
  const el = screen.getByText('Phase 0 smoke');
  assert.equal(el.tagName, 'P');
  cleanup();
});
