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
  web_accessible_resources: [{ resources: ['src/content/injected.ts'], matches: ['<all_urls>'] }]
});
