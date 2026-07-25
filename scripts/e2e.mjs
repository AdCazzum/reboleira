// End-to-end test THROUGH the actual Chrome extension.
//
// Everything else in tests/ stops at the module boundary: tests/content/offline-e2e.test.ts
// drives adaptPage() directly under jsdom, so it never loads the manifest, never
// starts the service worker, never injects a content script and never sends a
// chrome message. This script is the only thing that proves the extension itself
// works: it loads the built dist/ unpacked into a real Chromium, then drives the
// same code path a human drives.
//
// Deterministic by construction: it builds with `--mode e2e`, so CONFIG points at
// a closed port (see .env.e2e) and every live path — ENS, 0G Storage, 0G Compute —
// fails instantly and falls back to the bundled personas + pre-computed fixtures.
// No network, no wallet, no testnet funds. The live paths are verified by hand
// instead; see docs/E2E.md.
//
// Usage:
//   npm run e2e              headless
//   E2E_HEADED=1 npm run e2e watch it happen in a real window
//   E2E_KEEP=1 npm run e2e   leave the browser open at the end for poking around

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dist-e2e');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg'
};

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
  if (!ok) failures++;
}

/** Serves demo/ so pages load over http:// (fixtureFor keys off the URL path). */
function serveDemo() {
  const server = createServer(async (req, res) => {
    try {
      // Strip the query/hash and refuse anything trying to climb out of demo/.
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

/** Reads the text content of the adapted UI, piercing the renderer's shadow root. */
async function adaptedText(page) {
  return page.evaluate(() => document.getElementById('ensight-root')?.shadowRoot?.textContent ?? null);
}

/**
 * Asks the service worker to ping the content script in the tab whose URL
 * contains `needle`. Returns 'ok', or the failure reason — notably
 * "Receiving end does not exist" when no content script is listening.
 */
async function probeContentScript(sw, urlNeedle) {
  return sw.evaluate(async (needle) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => (t.url ?? '').includes(needle));
    if (!tab) return 'nessuna tab trovata';
    try { await chrome.tabs.sendMessage(tab.id, { type: 'ensight:probe' }); return 'ok'; }
    catch (e) { return String(e?.message ?? e); }
  }, urlNeedle);
}

/**
 * Content scripts run at document_idle, so they are not listening the instant
 * page.goto() resolves — sending the toggle straight away races them and
 * rejects with "Receiving end does not exist".
 */
async function waitForContentScript(sw, urlNeedle, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  do {
    last = await probeContentScript(sw, urlNeedle);
    if (!/Receiving end does not exist|nessuna tab/.test(last)) return last;
    await new Promise(r => setTimeout(r, 250));
  } while (Date.now() < deadline);
  return last;
}

/** Sends the popup's toggle message from the service worker, like the popup does. */
async function toggle(sw, urlNeedle) {
  await sw.evaluate(async (needle) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => (t.url ?? '').includes(needle));
    if (!tab) throw new Error(`nessuna tab con "${needle}"`);
    await chrome.tabs.sendMessage(tab.id, { type: 'ensight:toggle' });
  }, urlNeedle);
}

async function main() {
  console.log('[1/7] building the extension with mode=e2e (closed-port CONFIG)...');
  execFileSync('npx', ['vite', 'build', '--mode', 'e2e', '--outDir', 'dist-e2e', '--emptyOutDir'], {
    cwd: ROOT, stdio: 'inherit'
  });

  const { server, port } = await serveDemo();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[2/7] serving demo/ on ${baseUrl}`);

  const userDataDir = await mkdtemp(join(tmpdir(), 'ensight-e2e-'));
  // channel:'chromium' is required: the default headless build is the headless
  // shell, which cannot load extensions at all.
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.E2E_HEADED,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`]
  });

  try {
    console.log('[3/7] extension + service worker');
    const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20_000 });
    const extensionId = new URL(sw.url()).host;
    check('service worker attivo', Boolean(extensionId), sw.url());

    const page = await context.newPage();
    const errors = [];
    const logs = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => logs.push(m.text()));

    await page.goto(`${baseUrl}/page-a-news.html`);

    // Liveness, not side effects: data-ensight-id only appears once adaptPage
    // runs, so the way to know a content script is there is to talk to it.
    const reachable = await waitForContentScript(sw, 'page-a-news');
    check('content script raggiungibile via chrome.tabs.sendMessage',
      !/Receiving end does not exist|nessuna tab/.test(reachable), reachable);

    const injectedUrl = `chrome-extension://${extensionId}/src/content/injected.js`;
    const injectedStatus = await page.evaluate(u => fetch(u).then(r => r.status).catch(e => String(e)), injectedUrl);
    check('injected.js raggiungibile nel MAIN world (web_accessible_resources)', injectedStatus === 200, `status: ${injectedStatus}`);

    // Regression guard for a bug that made the whole wallet bridge dead in the
    // built extension: injected.js is a module (it imports ethers/config/zerog
    // chunks), so injecting it as a classic script threw "Cannot use import
    // statement outside a module" and the MAIN-world listener never registered.
    // Fetching the file 200s either way — the only proof is a round trip.
    // Re-posts on an interval: injected.js is a module script and evaluates
    // asynchronously, and postMessage is not queued for a listener that does
    // not exist yet — a single probe fired too early is simply lost. (The
    // extension itself solves this with the dir:'ready' handshake in
    // bridge.ts; here we just retry.)
    const bridgeReply = await page.evaluate(() => new Promise(done => {
      const onMsg = (e) => {
        const m = e.data;
        if (m?.source === 'ensight' && m.dir === 'res' && m.id === 'e2e-probe') {
          clearInterval(poll);
          window.removeEventListener('message', onMsg);
          done(m.error ?? '(nessun errore)');
        }
      };
      window.addEventListener('message', onMsg);
      const ask = () => window.postMessage({ source: 'ensight', dir: 'req', id: 'e2e-probe', method: '__probe__', params: [] }, '*');
      const poll = setInterval(ask, 250);
      ask();
      setTimeout(() => {
        clearInterval(poll);
        window.removeEventListener('message', onMsg);
        done('TIMEOUT: nessuna risposta dal MAIN world');
      }, 15_000);
    }));
    check('bridge MAIN world vivo (injected.js eseguito, non solo servito)',
      /metodo sconosciuto/.test(bridgeReply), bridgeReply);

    // The 0G SDKs' browser builds reach for Node globals (global, process.browser,
    // Buffer.from) while their modules evaluate. Each one threw in turn and killed
    // live inference silently — the page still adapted, from a fixture, so nothing
    // looked broken. vite.config.ts substitutes them; these two checks make sure
    // the substitution keeps working AND keeps staying out of the page.
    const bufferShim = await page.evaluate(() => {
      const B = globalThis.__ensightBuffer;
      if (!B) return 'assente';
      try { return B.from('hi').toString('base64') === 'aGk=' ? 'ok' : 'base64 errato'; }
      catch (e) { return String(e?.message ?? e); }
    });
    check('shim Buffer presente e funzionante nel MAIN world', bufferShim === 'ok', bufferShim);

    const nodeMarkers = await page.evaluate(() => ['Buffer', 'process', 'global'].filter(k => k in globalThis));
    check('nessun marcatore Node piantato nella pagina ospite', nodeMarkers.length === 0, nodeMarkers.join(', '));

    check('pagina non ancora adattata', (await adaptedText(page)) === null);

    console.log('[4/7] persona A: toggle -> UI adattata');
    await sw.evaluate(() => chrome.storage.local.set({ persona: 'personaA' }));
    await toggle(sw, 'page-a-news');
    await page.waitForFunction(() => document.getElementById('ensight-root') !== null, { timeout: 20_000 })
      .catch(() => {});
    const textA = await adaptedText(page);
    check('UI adattata presente', textA !== null);
    check('contenuto riscritto per persona A', Boolean(textA?.includes('Il porto di Genova ha raddoppiato il traffico di container nel 2026')),
      `testo: ${textA?.slice(0, 120)}`);
    check('blocco "hidden" della fixture assente', !textA?.includes('Offerta lampo: abbonati oggi al Corriere Fittizio'));
    // With .env.e2e every live dependency is a closed port, so BOTH live paths
    // must have been attempted and reported their fallback. If these go quiet,
    // either the live path stopped being attempted at all or the fallback
    // stopped being announced — and a silent fallback is exactly what made
    // "fixtures only" indistinguishable from "live" before.
    check('fallback del profilo annunciato in console', logs.some(l => /profilo: FALLBACK/.test(l)),
      logs.filter(l => l.includes('[ENSight]')).join(' | '));
    check('fallback della UISpec annunciato in console', logs.some(l => /UISpec: FALLBACK/.test(l)),
      logs.filter(l => l.includes('[ENSight]')).join(' | '));

    check('pagina originale nascosta', await page.evaluate(() =>
      [...document.body.children].filter(c => c.id !== 'ensight-root').every(c => c.style.display === 'none')));

    console.log('[5/7] persona B: la stessa pagina rende una UI diversa');
    await toggle(sw, 'page-a-news');
    check('toggle off ripristina la pagina originale', (await adaptedText(page)) === null &&
      await page.evaluate(() => [...document.body.children].every(c => c.style.display !== 'none')));

    await sw.evaluate(() => chrome.storage.local.set({ persona: 'personaB' }));
    await toggle(sw, 'page-a-news');
    await page.waitForFunction(() => document.getElementById('ensight-root') !== null, { timeout: 20_000 })
      .catch(() => {});
    const textB = await adaptedText(page);
    check('contenuto riscritto per persona B', Boolean(textB) && textB !== textA, `testo: ${textB?.slice(0, 120)}`);

    console.log('[6/7] seconda pagina demo (page-b-product, persona B)');
    const pageB = await context.newPage();
    pageB.on('pageerror', e => errors.push(String(e)));
    await pageB.goto(`${baseUrl}/page-b-product.html`);
    await waitForContentScript(sw, 'page-b-product');
    await toggle(sw, 'page-b-product');
    await pageB.waitForFunction(() => document.getElementById('ensight-root') !== null, { timeout: 20_000 })
      .catch(() => {});
    const textProduct = await adaptedText(pageB);
    check('scheda tecnica resa per persona B', Boolean(textProduct?.includes('FIDO2/WebAuthn/U2F/OTP hardware authenticator with USB-C and NFC connectivity')),
      `testo: ${textProduct?.slice(0, 120)}`);
    // "Support" appears only in the page's two navs, never in the fixture (the
    // fixture does have a legitimate "Documentation" section, so that word is
    // not a usable marker).
    check('nav del sito scartata dalla fixture', !textProduct?.includes('Support'));

    console.log('[7/7] popup');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/ui/popup/index.html`);
    check('popup renderizza', await popup.getByRole('button', { name: 'Adatta questa pagina' }).isVisible());
    // Regression guard: this button used to open chrome-extension://.../src/ui/onboarding/index.html,
    // a path that does not exist in the bundle — a dead white tab. It must now either
    // navigate to the configured onboarding URL or say the server is down.
    const tabsBefore = context.pages().length;
    await popup.getByRole('button', { name: 'Configura profilo' }).click();
    await popup.getByText(/Onboarding non raggiungibile/).waitFor({ timeout: 15_000 })
      .then(() => check('"Configura profilo" segnala il server spento invece di aprire una tab morta', true))
      .catch(err => check('"Configura profilo" segnala il server spento invece di aprire una tab morta', false,
        `${err.message} (tab aperte: ${tabsBefore} -> ${context.pages().length})`));
    // With .env.e2e's closed-port RPC the ENS read must fail, and the popup must
    // say so rather than claiming "non configurato" (which would be a lie).
    await popup.getByText(/lettura ENS fallita/).waitFor({ timeout: 20_000 })
      .then(() => check('stato profilo distingue "errore di lettura" da "non configurato"', true))
      .catch(err => check('stato profilo distingue "errore di lettura" da "non configurato"', false, err.message));

    check('nessun errore JS in pagina', errors.length === 0, errors.join('\n        '));
  } finally {
    if (process.env.E2E_KEEP) {
      console.log('\nE2E_KEEP=1 — browser lasciato aperto, Ctrl+C per chiudere.');
      await new Promise(() => {});
    }
    await context.close();
    server.close();
    await rm(userDataDir, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\nE2E PASS' : `\nE2E FAIL — ${failures} check falliti`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('\nE2E crashed:', err);
  process.exit(1);
});
