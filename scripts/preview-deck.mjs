// Captures the screenshots used by the pitch deck: the raw demo page, the same
// page adapted for each persona, the product page, and the toolbar popup.
//
// Same harness as scripts/e2e.mjs (real Chromium, dist-e2e built with
// `--mode e2e` so every live path fails fast into the committed fixtures), but
// it asserts nothing — it only shoots. Reuses an existing dist-e2e/ if present.
//
// Usage: node scripts/preview-deck.mjs [outDir]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dist-e2e');
const outDir = resolve(process.argv[2] ?? join(ROOT, 'deck-preview'));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg'
};

function serveDemo() {
  const server = createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
      const file = resolve(join(ROOT, 'demo', rel));
      if (!file.startsWith(join(ROOT, 'demo'))) { res.writeHead(403).end('forbidden'); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

async function waitForContentScript(sw, needle, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await sw.evaluate(async (n) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => (t.url ?? '').includes(n));
      if (!tab) return 'no tab';
      try { await chrome.tabs.sendMessage(tab.id, { type: 'ensight:probe' }); return 'ok'; }
      catch (e) { return String(e?.message ?? e); }
    }, needle);
    if (!/Receiving end does not exist|no tab/.test(r) || Date.now() > deadline) return r;
    await new Promise(t => setTimeout(t, 250));
  }
}

async function toggle(sw, needle) {
  await sw.evaluate(async (n) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => (t.url ?? '').includes(n));
    await chrome.tabs.sendMessage(tab.id, { type: 'ensight:toggle' });
  }, needle);
}

const adapted = page => page.evaluate(() => document.getElementById('ensight-root') !== null);

await mkdir(outDir, { recursive: true });
const built = await stat(join(DIST, 'manifest.json')).then(() => true).catch(() => false);
if (!built) {
  console.log('building dist-e2e...');
  execFileSync('npx', ['vite', 'build', '--mode', 'e2e', '--outDir', 'dist-e2e', '--emptyOutDir'],
    { cwd: ROOT, stdio: 'inherit' });
}

const { server, port } = await serveDemo();
const baseUrl = `http://127.0.0.1:${port}`;
const userDataDir = await mkdtemp(join(tmpdir(), 'ensight-deck-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`]
});

const shots = [];
async function shoot(page, name, fullPage = false) {
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  shots.push(file);
}

try {
  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20_000 });
  const extensionId = new URL(sw.url()).host;

  const page = await context.newPage();
  await page.goto(`${baseUrl}/page-a-news.html`);
  await waitForContentScript(sw, 'page-a-news');
  await shoot(page, '10-news-original');

  await sw.evaluate(() => chrome.storage.local.set({ persona: 'personaA' }));
  await toggle(sw, 'page-a-news');
  await page.waitForFunction(() => document.getElementById('ensight-root') !== null, { timeout: 20_000 });
  await page.waitForTimeout(500);
  await shoot(page, '11-news-persona-a');

  await toggle(sw, 'page-a-news');
  await page.waitForFunction(() => document.getElementById('ensight-root') === null, { timeout: 20_000 });
  await sw.evaluate(() => chrome.storage.local.set({ persona: 'personaB' }));
  await toggle(sw, 'page-a-news');
  await page.waitForFunction(() => document.getElementById('ensight-root') !== null, { timeout: 20_000 });
  await page.waitForTimeout(500);
  await shoot(page, '12-news-persona-b');

  const pageB = await context.newPage();
  await pageB.goto(`${baseUrl}/page-b-product.html`);
  await waitForContentScript(sw, 'page-b-product');
  await shoot(pageB, '20-product-original');
  await sw.evaluate(() => chrome.storage.local.set({ persona: 'personaA' }));
  await toggle(sw, 'page-b-product');
  await pageB.waitForFunction(() => document.getElementById('ensight-root') !== null, { timeout: 20_000 });
  await pageB.waitForTimeout(500);
  await shoot(pageB, '21-product-persona-a');

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 480 });
  await popup.goto(`chrome-extension://${extensionId}/src/ui/popup/index.html`);
  await popup.waitForTimeout(1500);
  await shoot(popup, '30-popup', true);

  console.log(`adapted=${await adapted(page)}`);
} finally {
  await context.close();
  server.close();
  await rm(userDataDir, { recursive: true, force: true });
}

console.log('written:');
for (const s of shots) console.log(`  ${s}`);
