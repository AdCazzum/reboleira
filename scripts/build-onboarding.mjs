// Bundles demo/onboarding.tsx - the Task 16 localhost onboarding wizard - into
// a single self-contained demo/onboarding.js so a human can open
// demo/onboarding.html in a browser with MetaMask and run the real
// connect -> World ID verify -> profile form -> encrypt -> 0G Storage upload
// -> ENS write flow, against the REAL src/core/crypto.ts,
// src/services/world-id.ts, src/services/zerog-storage.ts and src/config.ts
// (no copies, no mocks).
//
// Bundler choice: same rationale as scripts/build-wallet-test.mjs - esbuild
// is not an installed dependency in this repo (only an optional peer of
// vite), so this uses vite's own programmatic build() API instead. vite is a
// real devDependency already in package.json/package-lock.json, so this
// build works out of the box for anyone who has just run `npm install`, with
// zero extra installs and zero changes to package.json/package-lock.json.
//
// vite.config.ts (the extension build, crx plugin, manifest, etc.) is
// intentionally NOT used here (`configFile: false`) - this is a completely
// separate, dev-only build target. import.meta.env (which src/config.ts
// reads at module load, via CONFIG) is handled natively by vite's own
// client-env replacement, so no extra `define` is required for it to load
// without throwing - fill in .env (see .env.example) before running this
// build, exactly as for `npm run build`.
//
// Two extras beyond build-wallet-test.mjs, both required to make this
// specific bundle work:
//
// 1. JSX: demo/onboarding.tsx is a Preact .tsx file (same convention as
//    src/ui/popup/popup.tsx), so esbuild (vite's transform layer) needs the
//    automatic JSX runtime pointed at preact, same as tsconfig.json's
//    "jsx"/"jsxImportSource" pair for the src/ build.
//
// 2. React->Preact alias: @worldcoin/idkit (4.2.1 - World ID 4.0; see the
//    header comment in demo/onboarding.tsx and the fix-report sections of
//    .superpowers/sdd/2026-07-24-ensight/task-16-partB-report.md for the
//    full history, including a detour through a 2.4.2 pin that this repo no
//    longer uses) is a React package (peerDependencies: react/react-dom
//    >=18, plus WASM internals via idkit-core) and this repo only installs
//    preact, no react/react-dom in node_modules. Aliasing
//    react/react-dom/react-dom/client/react's jsx-runtime to preact/compat's
//    equivalents (which ship as part of the already-installed `preact`
//    package, no new deps) lets IDKitRequestWidget and everything it pulls
//    in resolve and render through Preact. Verified: this alias is REQUIRED
//    (without it, the build fails to resolve "react"), and it is SUFFICIENT
//    - a jsdom render smoke test (IDKitRequestWidget mounted via
//    preact/compat with a real rp_context, closed state) produced the
//    expected `<button>Verify with World ID</button>` from the surrounding
//    markup with no throw, and the WASM chunk (idkit_wasm_bg*.wasm, ~869 KB)
//    bundles and gets emitted as its own asset without issue.
//
// Usage: node scripts/build-onboarding.mjs
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await build({
  root,
  configFile: false,
  logLevel: 'info',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact'
  },
  resolve: {
    alias: {
      'react-dom/client': 'preact/compat/client',
      'react-dom': 'preact/compat',
      react: 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime'
    }
  },
  build: {
    outDir: 'demo',
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
    rollupOptions: {
      input: { onboarding: path.resolve(root, 'demo/onboarding.tsx') },
      output: {
        format: 'es',
        entryFileNames: 'onboarding.js'
      }
    }
  }
});

console.log('Built demo/onboarding.js');
