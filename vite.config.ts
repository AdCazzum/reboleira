import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import manifest from './src/manifest.config';
export default defineConfig({
  plugins: [preact(), crx({ manifest })],
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
