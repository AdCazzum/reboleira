// Renders demo/onboarding.html in a real Chromium and writes a screenshot per
// screen, so the wizard's layout can be verified without a wallet, testnet
// funds or the World ID simulator.
//
// Serves demo/ itself rather than reusing scripts/onboarding-server.mjs: that
// server exits fatally without WORLD_RP_SIGNING_KEY/WORLD_RP_ID, which this
// harness has no business needing. It answers OPTIONS /rp-context with 204,
// exactly as the real server does, so the page's preflight signer check
// passes here too.
//
// Usage: node scripts/preview-onboarding.mjs [outDir]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const demoDir = join(root, 'demo');
const outDir = resolve(process.argv[2] ?? join(root, 'demo-preview'));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png'
};

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/rp-context') {
    res.writeHead(req.method === 'OPTIONS' ? 204 : 501).end();
    return;
  }
  try {
    const file = join(demoDir, path === '/' ? 'onboarding.html' : path.replace(/^\/+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// A wallet stub good enough to walk the UI: it answers the four RPC methods
// the wizard calls before it needs a real signature, and never signs anything.
const WALLET_STUB = `
  window.ethereum = {
    isMetaMask: true,
    _chainId: '0xAA36A7',
    request: async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts')
        return ['0x1111111111111111111111111111111111111111'];
      if (method === 'eth_chainId') return window.ethereum._chainId;
      if (method === 'net_version') return '11155111';
      return null;
    },
    on: () => {}, removeListener: () => {}
  };
`;

await mkdir(outDir, { recursive: true });
await new Promise(done => server.listen(0, done));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));

const shots = [];
async function shoot(name) {
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(file);
}

// try/finally so a thrown waitForSelector/locator failure (expected at this
// point in the plan — see the module comment) still closes the browser and
// the server instead of leaking a Chromium subprocess and the port.
let failure = null;
try {
  await page.addInitScript(WALLET_STUB);
  await page.goto(`${base}/onboarding.html`);
  await page.waitForSelector('.stepper', { timeout: 15_000 });

  await shoot('01-step1-connect');

  await page.getByRole('button', { name: /connect wallet/i }).click();
  await page.waitForSelector('[data-step="2"]', { timeout: 15_000 });
  await shoot('02-step2-verify');

  // Jump straight to step 3: step 2 needs the World ID simulator, which this
  // harness deliberately does not stand up.
  await page.evaluate(() => window.__ensightGoToStep?.(3));
  await page.waitForSelector('[data-step="3"]', { timeout: 15_000 });
  await shoot('03-step3-profile');

  await page.getByRole('checkbox', { name: /larger text/i }).check();
  await page.getByRole('checkbox', { name: /dyslexia/i }).check();
  await shoot('04-step3-preview-adapted');

  await page.locator('#log-disclosure summary').click();
  await shoot('05-log-open');
} catch (e) {
  failure = e;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}

console.log(`Screenshots written to ${outDir}:`);
for (const s of shots) console.log(`  ${s}`);
if (errors.length > 0) {
  console.error(`\n${errors.length} console/page error(s):`);
  for (const e of errors) console.error(`  ${e}`);
}
if (failure) {
  console.error(`\nScreenshot sequence failed: ${failure}`);
}
if (errors.length > 0 || failure) {
  process.exit(1);
}
console.log('\nNo console or page errors.');
