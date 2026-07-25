import { adaptPage } from './adapt';
import { fixtureFor, type PersonaKey } from '../../demo/fixtures';
import type { PersonaProfile } from '../core/types';
import personaAJson from '../../demo/personas/persona-a.json';
import personaBJson from '../../demo/personas/persona-b.json';

let adaptedRoot: HTMLElement | null = null;
const originals: HTMLElement[] = [];

// Inietta injected.ts nel MAIN world (fuori dal contesto ISOLATED del content
// script) cosicché possa accedere a window.ethereum. Comunica col content
// script via bridge.ts (window.postMessage, protocollo { source:'ensight' }).
(function injectMainWorldScript() {
  const s = document.createElement('script');
  // Built path (see vite.config.ts + src/manifest.config.ts): crxjs only bundles
  // manifest-declared entry points, so injected.ts is compiled to a stable
  // 'src/content/injected.js' output rather than served from its .ts source.
  s.src = chrome.runtime.getURL('src/content/injected.js');
  s.onload = () => s.remove();
  document.documentElement.appendChild(s);
})();

async function activePersona(): Promise<PersonaKey> {
  const { persona } = await chrome.storage.local.get('persona') as { persona?: PersonaKey };
  return persona ?? 'personaA';
}

// Dev/demo: import statico dei profili persona da demo/personas. Verrà sostituito
// dal percorso 0G (recupero on-chain/off-chain del profilo) nei task successivi.
async function loadProfile(persona: PersonaKey): Promise<PersonaProfile> {
  const profile = persona === 'personaB' ? personaBJson : personaAJson;
  return profile as PersonaProfile;
}

async function enable() {
  const persona = await activePersona();
  const profile = await loadProfile(persona);
  adaptedRoot = await adaptPage(document, profile, async () => fixtureFor(location.href, persona));
  [...document.body.children].forEach(c => { (c as HTMLElement).style.display = 'none'; originals.push(c as HTMLElement); });
  document.body.appendChild(adaptedRoot);
}
function disable() {
  adaptedRoot?.remove(); adaptedRoot = null;
  originals.forEach(c => c.style.display = ''); originals.length = 0;
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'ensight:toggle') { adaptedRoot ? disable() : enable(); }
});
