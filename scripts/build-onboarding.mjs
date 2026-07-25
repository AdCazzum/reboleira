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
// 2. React->Preact alias: @worldcoin/idkit (pinned to 2.4.2 - see
//    package.json comment / the fix-report section of
//    .superpowers/sdd/2026-07-24-ensight/task-16-partB-report.md for why
//    2.4.2 and not the 4.x that npm installs by default) is a React package
//    - not just a peer dependency of react/react-dom, but one that pulls in
//    framer-motion, @radix-ui/react-dialog, @radix-ui/react-toast and
//    zustand internally, none of which are otherwise used in this repo -
//    and this repo only installs preact, no react/react-dom in
//    node_modules. Aliasing react/react-dom/react-dom/client/react's
//    jsx-runtime to preact/compat's equivalents (which ship as part of the
//    already-installed `preact` package, no new deps) lets IDKitWidget and
//    everything it pulls in resolve and render through Preact. Verified:
//    this alias is REQUIRED (without it, the build fails to resolve
//    "react"), and it is SUFFICIENT - a jsdom render smoke test
//    (IDKitWidget mounted via preact/compat, closed state) produced the
//    expected `<button>Verify with World ID</button>` from the render-prop
//    child with no throw, so framer-motion/@radix-ui/zustand tolerate
//    preact/compat fine here.
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
