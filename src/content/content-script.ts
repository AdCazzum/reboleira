import { adaptPage } from './adapt';
import { fixtureFor, type PersonaKey } from '../../demo/fixtures';
import type { PersonaProfile } from '../core/types';
import personaAJson from '../../demo/personas/persona-a.json';
import personaBJson from '../../demo/personas/persona-b.json';

let adaptedRoot: HTMLElement | null = null;
const originals: HTMLElement[] = [];

async function activePersona(): Promise<PersonaKey> {
  const { persona } = await chrome.storage.local.get('persona');
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
