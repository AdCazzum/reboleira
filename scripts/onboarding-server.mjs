// Task 16, Part B - local dev server for demo/onboarding.html.
//
// Why this exists: idkit v4's rp_context needs a signature produced by
// @worldcoin/idkit/signing's signRequest(), which has a hard runtime guard
// (node_modules/@worldcoin/idkit-server/dist/index.js, isServerEnvironment())
// that throws "signRequest can only be used in Node.js environments ..." the
// instant it detects it is NOT running under Node/Deno/Bun (i.e. the
// browser). Calling it from demo/onboarding.tsx - a browser bundle - always
// throws. There is no way around this: it is a deliberate guard, not a bug,
// and the World Developer Portal's proof-context endpoint only returns app
// metadata (app_id, rp_id, name, logos, action) - not a signed
// {nonce, signature} context - so it is not a hosted signer either. The
// signature MUST come from something running in Node.
//
// This script is that something: a single local process that both serves
// demo/ as static files AND exposes a same-origin POST /rp-context endpoint
// that calls the REAL signRequest() (which runs happily here, since
// isServerEnvironment() sees a real Node process) and returns the signed
// context as JSON. demo/onboarding.tsx fetches it from the same origin it
// was served from, so no CORS dance is strictly needed (CORS headers are
// still sent, defensively, in case someone serves the page from elsewhere
// during dev).
//
// Usage:
//   node scripts/onboarding-server.mjs
//   PORT=8081 node scripts/onboarding-server.mjs
//
// Reads WORLD_RP_SIGNING_KEY and WORLD_RP_ID from the environment; if unset
// there, falls back to parsing a `.env` file in the repo root (KEY=VALUE per
// line, `#` comments and blank lines ignored - no dotenv dependency, this
// repo doesn't have one). Deliberately NOT VITE_-prefixed: a VITE_-prefixed
// var gets inlined into the browser bundle by scripts/build-onboarding.mjs
// (Vite embeds every VITE_ var into import.meta.env, referenced or not) -
// the whole point of this server is that the signing key never has to leave
// this Node process. See .env.example for the matching entries.
import { createServer } from 'node:http';
import { readFile, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signRequest } from '@worldcoin/idkit/signing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const demoDir = path.resolve(root, 'demo');

// ---- env: process.env wins; fall back to parsing a repo-root .env ----
function loadDotEnv(file) {
  const out = {};
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const dotEnv = loadDotEnv(path.join(root, '.env'));
function getEnv(key) {
  return process.env[key] ?? dotEnv[key];
}

const RP_KEY = getEnv('WORLD_RP_SIGNING_KEY');
const RP_ID = getEnv('WORLD_RP_ID');
const WORLD_ACTION_FALLBACK = getEnv('VITE_WORLD_ACTION') || 'verify-human';
const PORT = Number(process.env.PORT) || 8080;

if (!RP_KEY) {
  console.error(
    '\nFATAL: WORLD_RP_SIGNING_KEY is not set (checked process.env and .env in the repo root).\n' +
      'This is the demo-only World ID 4.0 RP signing key - see .env.example for the ' +
      '(placeholder) entry and where it comes from. Set it and re-run:\n' +
      '  WORLD_RP_SIGNING_KEY=0x... node scripts/onboarding-server.mjs\n'
  );
  process.exit(1);
}
if (!RP_ID) {
  console.error(
    '\nFATAL: WORLD_RP_ID is not set (checked process.env and .env in the repo root).\n' +
      'This is the World ID 4.0 Relying Party id (rp_...) - see .env.example.\n'
  );
  process.exit(1);
}

// ---- static file serving ----
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm', // critical: idkit_wasm_bg.wasm won't instantiate as application/octet-stream
  '.svg': 'image/svg+xml', // likewise: <img> refuses to render SVG served as application/octet-stream
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

function mimeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relPath = urlPath === '/' ? 'onboarding.html' : urlPath.replace(/^\/+/, '');
  const resolved = path.normalize(path.join(demoDir, relPath));

  // Path-traversal guard: resolved path must stay inside demoDir.
  if (!resolved.startsWith(demoDir + path.sep) && resolved !== demoDir) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${urlPath}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeFor(resolved) });
    res.end(data);
  });
}

// ---- POST /rp-context: the actual signing endpoint ----
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handleRpContext(req, res) {
  withCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'POST only' }));
    return;
  }
  try {
    const bodyText = await readBody(req);
    let action = WORLD_ACTION_FALLBACK;
    if (bodyText.trim()) {
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Malformed JSON body' }));
        return;
      }
      if (typeof parsed.action === 'string' && parsed.action) action = parsed.action;
    }

    const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: RP_KEY, action });
    const payload = {
      rp_id: RP_ID,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
      signature: sig
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}

const server = createServer((req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  if (urlPath === '/rp-context') {
    handleRpContext(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Serving ${demoDir} at http://localhost:${PORT}/`);
  console.log(`Open http://localhost:${PORT}/onboarding.html`);
  console.log(`rp-context signer ready (rp_id=${RP_ID}, POST http://localhost:${PORT}/rp-context)`);
});
