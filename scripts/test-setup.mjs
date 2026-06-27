// Test environment bootstrap: install a happy-dom Window as the global
// `window` / `document` / `navigator` so React testing-library and any other
// DOM-dependent code can render under Node's built-in test runner.
//
// Loaded via `--import ./scripts/test-setup.mjs` in package.json's test:unit
// script, BEFORE the ts-resolver register hook. This means happy-dom must
// already be installed (i.e. `npm install` has been run) when tests start.

import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });

// React 18's act() / render require this flag to silence the "not configured
// to support act()" warning when running outside jsdom.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Node 22+ has a built-in read-only `navigator` global; happy-dom's Window
// supplies its own via the returned instance, so we do not need to assign it
// to globalThis. Some other names (window, document, …) are also pre-defined
// in Node 22+ as read-only getters, so we use defineProperty with `configurable`
// to overwrite them.
function setGlobal(name, value) {
  try {
    globalThis[name] = value;
  } catch {
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
    });
  }
}

setGlobal('window', window);
setGlobal('document', window.document);
setGlobal('HTMLElement', window.HTMLElement);
setGlobal('Element', window.Element);
setGlobal('Node', window.Node);
setGlobal('Text', window.Text);
setGlobal('DocumentFragment', window.DocumentFragment);
setGlobal('HTMLCanvasElement', window.HTMLCanvasElement);
setGlobal('getComputedStyle', window.getComputedStyle.bind(window));
setGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
setGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
setGlobal('matchMedia', window.matchMedia.bind(window));
setGlobal('ResizeObserver', window.ResizeObserver);
