import { defineManifest } from '@crxjs/vite-plugin';
export default defineManifest({
  manifest_version: 3,
  name: 'ENSight',
  version: '0.1.0',
  action: { default_popup: 'src/ui/popup/index.html' },
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
