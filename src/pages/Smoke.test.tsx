// e2e #1: Home smoke + DemoBanner (see .planning/ui-e2e-coverage/task_plan.md).
//
// What this catches that the 49 unit tests cannot:
//   - App mounts at all under happy-dom (lazy chunks + Suspense + antd Layout)
//   - Root path "/" redirects to "/dashboard" (catch-all route regression)
//   - DemoBanner is rendered on every page (was silently dropped once, see REVIEW.md #5)
//   - Sider "Demo / Mock" tag and Header "Non-clinical preview" tag both render
//
// Notes / trade-offs:
//   - We use MemoryRouter instead of HashRouter because the test runs in a
//     non-browser Node process and we want deterministic initialEntries.
//   - Dashboard's getDashboardOverview() will throw (no mock-api running);
//     clinicApi has a built-in network-error fallback to buildFallbackDashboard(),
//     so the page renders mock data and does NOT crash the test.
//   - All three tests render inside their own MemoryRouter, so isolation is
//     enforced at the component level rather than relying on Node test
//     runner isolation flags.

import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

afterEach(() => {
  cleanup();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

test('App mounts and renders the global DemoBanner on every page', async () => {
  // DemoBanner sits inside MainLayout, OUTSIDE the lazy <Suspense>, so it must
  // appear even before the Dashboard chunk finishes loading.
  renderAt('/');
  const banner = await screen.findByText(/Demo \/ Research Preview/i, {}, { timeout: 5000 });
  assert.ok(banner, 'DemoBanner message should be present');
  // Catch a regression where the demo disclaimer text gets silently dropped.
  await screen.findByText(/不可用于临床决策/, {}, { timeout: 5000 });
});

test('MainLayout renders the "Non-clinical preview" header tag and the "Demo / Mock" sider tag', async () => {
  renderAt('/dashboard');
  // Header tag — orange, top-right cluster in the page chrome.
  await screen.findByText('Non-clinical preview', {}, { timeout: 5000 });
  // Sider brand-status tag — the "Mode" line under the logo.
  await screen.findByText(/Demo \/ Mock/, {}, { timeout: 5000 });
});

test('root path "/" redirects to /dashboard and Dashboard page mounts', async () => {
  // The "/" route uses <Navigate to="/dashboard" replace />, and the Dashboard
  // chunk is lazy-loaded. If either breaks, this test fails.
  renderAt('/');
  // Dashboard's <Title> renders the Chinese page heading.
  const title = await screen.findByText(/心电工作台总览/, {}, { timeout: 5000 });
  assert.equal(title.tagName, 'H1');
  // The Dashboard Alert description includes the fallback source label, which
  // is the user-visible signal that "mock-api is not running" works. The same
  // label is rendered in three spots (alert.message, alert.description, and a
  // sider tag), so use findAllByText + assert at-least-one rather than
  // findByText (which requires a single match).
  const matches = await screen.findAllByText(
    /PTB-XL 20 条备份/,
    {},
    { timeout: 5000 },
  );
  assert.ok(matches.length >= 1, 'expected PTB-XL 20 条备份 to appear at least once');
});