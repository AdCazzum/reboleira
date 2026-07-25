import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import manifest from './src/manifest.config';
export default defineConfig({
  plugins: [preact(), crx({ manifest })],
  // The 0G Compute SDK declares a `browser` field remapping Node's crypto/stream
  // to crypto-browserify/stream-browserify, and those shims reference the Node
  // global `global`, which does not exist in a browser. Without this the SDK
  // chunk throws "global is not defined" the moment it evaluates, so every live
  // inference attempt died before reaching the network and silently fell back to
  // the demo fixtures.
  //
  // A build-time rewrite rather than a runtime `globalThis.global = globalThis`:
  // injected.ts runs in the visited page's MAIN world, so defining `global`
  // there would leak a Node marker into the page and could convince the site's
  // own libraries they are running under Node. (This substitution only touches
  // bare `global` identifiers — never `foo.global`, so RegExp.prototype.global
  // and property keys are left alone.)
  // `process` needs the same treatment: crypto-browserify bundles
  // readable-stream, which reads `process.browser` (and `process.nextTick`) while
  // the module is still evaluating, so it throws before any of our code runs.
  //
  // Substituted with a self-contained literal instead of a global, for the same
  // page-isolation reason as `global`. `versions` is deliberately left EMPTY:
  // the 0G SDKs detect Node with `process.versions.node !== undefined`, so an
  // empty object keeps that check correctly false and they take their browser
  // code paths (e.g. WebCrypto instead of node:crypto randomBytes).
  define: {
    global: 'globalThis',
    process: '({browser:true,env:{},versions:{},version:"",platform:"browser",arch:"",nextTick:(f,...a)=>Promise.resolve().then(()=>f(...a)),cwd:()=>"/"})'
  },
  build: {
    rollupOptions: {
      // crxjs bundles only manifest-declared entries (content_scripts/background/html).
      // injected.ts is loaded manually via chrome.runtime.getURL() + web_accessible_resources,
      // so it must be declared as its own Rollup input to actually get transpiled/bundled
      // (otherwise it is copied verbatim as a static asset, unresolved TS/imports and all).
      input: { injected: 'src/content/injected.ts' },
      output: {
        // Stable, unhashed filename for the injected entry so src/content/content-script.ts
        // and web_accessible_resources can reference it by a fixed path.
        entryFileNames: (chunk) => chunk.name === 'injected' ? 'src/content/injected.js' : 'assets/[name]-[hash].js'
      }
    }
  }
});
