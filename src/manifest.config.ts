import { defineManifest } from '@crxjs/vite-plugin';
export default defineManifest({
  manifest_version: 3,
  name: 'ENSight',
  version: '0.1.0',
  // PNG e non SVG perché Chrome non accetta vettori qui. Sono generati da
  // src/ui/icons/mark.svg con `npm run icons` e committati, così una build
  // pulita non ha bisogno di Chromium; tests/mark.test.ts controlla che
  // esistano e siano della misura dichiarata.
  //
  // `icons` e `action.default_icon` ripetono gli stessi file ma non sono
  // intercambiabili: il primo veste il gestore estensioni e il Web Store, il
  // secondo il bottone in toolbar. Senza il secondo la toolbar resterebbe col
  // tassello di puzzle anche con `icons` a posto.
  icons: {
    16: 'src/ui/icons/icon-16.png',
    32: 'src/ui/icons/icon-32.png',
    48: 'src/ui/icons/icon-48.png',
    128: 'src/ui/icons/icon-128.png'
  },
  action: {
    default_popup: 'src/ui/popup/index.html',
    default_icon: {
      16: 'src/ui/icons/icon-16.png',
      32: 'src/ui/icons/icon-32.png',
      48: 'src/ui/icons/icon-48.png',
      128: 'src/ui/icons/icon-128.png'
    }
  },
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  permissions: ['activeTab', 'scripting', 'storage'],
  host_permissions: ['<all_urls>'],
  content_scripts: [{
    matches: ['<all_urls>'],
    js: ['src/content/content-script.ts'],
    run_at: 'document_idle'
  }],
  // 'src/content/injected.js' is the bundled output of src/content/injected.ts
  // (see vite.config.ts rollupOptions.input/entryFileNames) — the .ts source itself
  // is never web-accessible since crxjs would only copy it verbatim, unbundled.
  web_accessible_resources: [{ resources: ['src/content/injected.js'], matches: ['<all_urls>'] }]
});
