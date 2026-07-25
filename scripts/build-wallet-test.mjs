// Bundles demo/wallet-test.ts - the Task 12 MetaMask wallet-bridge manual
// test harness - into a single self-contained demo/wallet-test.js so a
// human can open demo/wallet-test.html in a browser with MetaMask and
// manually exercise callInjected('eth_requestAccounts', []) and
// callInjected('personal_sign', [SIGN_MESSAGE]) against the REAL
// src/content/bridge.ts + src/content/injected.ts + src/core/crypto.ts
// (no copies, no mocks).
//
// Bundler choice: the task brief suggested esbuild ("already available
// transitively via vite"). In THIS repo that assumption doesn't hold -
// vite 8.x (see package.json) bundles internally via rolldown, and
// esbuild is only an *optional* peer dependency that is not actually
// installed (`npm ls esbuild` -> empty). Rather than reaching outside the
// lockfile (e.g. `npm install esbuild --no-save`, which is not
// reproducible after a fresh `npm ci`/`npm install`), this script uses
// vite's own programmatic build() API instead - vite is a REAL
// devDependency already in package.json/package-lock.json, so this build
// works out of the box for anyone who has just run `npm install`, with
// zero extra installs and zero changes to package.json/package-lock.json.
//
// vite.config.ts (the extension build, crx plugin, manifest, etc.) is
// intentionally NOT used here (`configFile: false`) - this is a
// completely separate, dev-only build target. import.meta.env (which
// src/config.ts reads at module load, via CONFIG) is handled natively by
// vite's own client-env replacement, so no extra `define` is required for
// it to load without throwing.
//
// Usage: node scripts/build-wallet-test.mjs
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await build({
  root,
  configFile: false,
  logLevel: 'info',
  build: {
    outDir: 'demo',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: { 'wallet-test': path.resolve(root, 'demo/wallet-test.ts') },
      output: {
        format: 'es',
        entryFileNames: 'wallet-test.js'
      }
    }
  }
});

console.log('Built demo/wallet-test.js');
