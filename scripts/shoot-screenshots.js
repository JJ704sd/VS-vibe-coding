// Take screenshots of running dev server for README
// Pages: dashboard, cases, annotation studio, training dashboard, AI models
// Strategy: app uses HashRouter, so the URL path is always "/" and we
// navigate by setting window.location.hash between captures. This avoids
// the webpack-dev-server historyApiFallback edge case where 404s are NOT
// actually rewritten (the "404s will fallback" banner is logged but
// `static.directory` ordering keeps the 404 path intact).
// Also strips the webpack-dev-server client overlay before each shot.

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = 'http://localhost:3000';
const VIEWPORT = { width: 1440, height: 900 };

const PAGES = [
  { name: 'dashboard',  hash: '#/dashboard',  waitFor: '心电工作台总览' },
  { name: 'cases',      hash: '#/cases',      waitFor: '患者' },
  { name: 'annotation', hash: '#/annotation', waitFor: '导入' },
  { name: 'training',   hash: '#/training',   waitFor: '训练' },
  { name: 'ai-models',  hash: '#/ai-models',  waitFor: 'AI' },
];

async function killOverlay(page) {
  // webpack-dev-server client overlay lives in #webpack-dev-server-client-overlay
  // We remove it after each navigation so it doesn't cover the screenshot
  await page.evaluate(() => {
    const ids = ['webpack-dev-server-client-overlay'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    // Also remove any stray iframes injected by the dev server
    document.querySelectorAll('iframe').forEach((f) => {
      if ((f.src || '').includes('webpack') || (f.src || '').startsWith('webpack-dev-server')) {
        f.remove();
      }
    });
  }).catch(() => {});
}

// Dismiss user-visible banners before each shot:
// - AntD message (top-center toast, e.g. "Firebase 初始化失败")
// - AntD notification (top-right corner, also a possible mount point)
// - Per-page AntD Alert banners (e.g. AnnotationStudio's Firebase Alert)
// These show up because firebaseService throws when the dev env is missing
// REACT_APP_FIREBASE_* keys. They are intentional UX in the app, but they
// occlude the workbench content for screenshots.
async function dismissBanners(page) {
  await page.evaluate(() => {
    // Antd message + notification portals share the .ant-message / .ant-notification
    // wrapper classes. Remove them so a follow-up screenshot is clean.
    document.querySelectorAll('.ant-message, .ant-notification').forEach((el) => {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    // AnnotationStudio mounts an Alert at the top of the workbench with
    // type="error" when Firebase init throws. Dismiss the close button if
    // present, otherwise remove the Alert element directly.
    document.querySelectorAll('.ant-alert-error').forEach((el) => {
      const closeBtn = el.querySelector('.ant-alert-close-icon');
      if (closeBtn) {
        closeBtn.click();
      } else if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });
  }).catch(() => {});
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=zh-CN', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });

    // First load lands on the SPA root so the React app boots and the
    // HashRouter is in place; subsequent navigation is by hash only.
    console.log(`\n>>> boot ${BASE}/`);
    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
    // Initial wait: the app shows the route-loading spinner; the dashboard
    // copy ("心电工作台总览") is the first page rendered.
    try {
      await page.waitForFunction(
        (needle) => document.body && document.body.innerText.includes(needle),
        { timeout: 20000 },
        '心电工作台总览'
      );
    } catch (e) {
      console.warn('initial dashboard copy not found within 20s');
    }
    await new Promise((r) => setTimeout(r, 800));
    await killOverlay(page);

    for (const p of PAGES) {
      const url = BASE + '/' + p.hash;
      console.log(`\n>>> ${p.name} -> ${url}`);
      // Setting hash doesn't trigger a full reload, so we don't wait for
      // networkidle2 (it would be a no-op). Just wait for the new page's
      // anchor text to appear, then settle for animations.
      await page.evaluate((h) => { window.location.hash = h; }, p.hash);
      try {
        await page.waitForFunction(
          (needle) => document.body && document.body.innerText.includes(needle),
          { timeout: 20000 },
          p.waitFor
        );
      } catch (e) {
        console.warn(`waitFor("${p.waitFor}") timeout — capturing anyway`);
      }
      // Settle for animations + lazy chunk load
      await new Promise((r) => setTimeout(r, 1500));
      await killOverlay(page);
      await dismissBanners(page);

      const file = path.join(OUT_DIR, `${p.name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      console.log(`saved ${file}`);
    }
  } catch (err) {
    console.error('FATAL', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
