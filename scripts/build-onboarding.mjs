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
// 2. React->Preact alias: @worldcoin/idkit is a React package
//    (peerDependencies: react/react-dom >=18) and this repo only installs
//    preact - no react/react-dom in node_modules. Aliasing react/react-dom/
//    react's jsx-runtime to preact/compat's equivalents (which ship as part
//    of the already-installed `preact` package, no new deps) lets any
//    React-authored component resolve and render through Preact.
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
      react: 'preact/compat',
      'react-dom': 'preact/compat',
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
