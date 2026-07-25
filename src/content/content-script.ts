import { JsonRpcProvider } from 'ethers';
import { adaptPage } from './adapt';
import type { SpecProvider } from './adapt';
import { callInjected } from './bridge';
import { resolveProfile, resolveSpec } from './content-script-helpers';
import { fixtureFor, type PersonaKey } from '../../demo/fixtures';
import type { PersonaProfile } from '../core/types';
import personaAJson from '../../demo/personas/persona-a.json';
import personaBJson from '../../demo/personas/persona-b.json';
import { CONFIG } from '../config';
import { readProfilePointer } from '../services/ens';
import { createZeroGStorageBackend, loadProfile as loadProfileFromZeroG } from '../services/zerog-storage';
import { createZeroGBroker, requestUISpec } from '../services/zerog-compute';
import { deriveKey, SIGN_MESSAGE } from '../core/crypto';

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

function staticPersonaProfile(persona: PersonaKey): PersonaProfile {
  return (persona === 'personaB' ? personaBJson : personaAJson) as PersonaProfile;
}

// ---- live profile path (ENS -> 0G Storage), with a best-effort session cache ----
//
// The cache is purely an optimization (skip re-signing/re-downloading on every
// page load); it must never be the reason the live path fails. Any get/set
// failure here (e.g. session storage access not yet granted to this content
// script's context) is swallowed and treated as a cache miss/no-op -- the real
// safety net is resolveProfile()'s withFallback to the static persona JSON
// below, which catches everything else (no ENS pointer set, RPC down,
// signature rejected, 0G Storage unreachable, ...).
async function getCachedProfile(profileUri: string): Promise<PersonaProfile | undefined> {
  try {
    const stored = await chrome.storage.session.get(profileUri) as Record<string, PersonaProfile>;
    return stored[profileUri];
  } catch {
    return undefined;
  }
}
async function setCachedProfile(profileUri: string, profile: PersonaProfile): Promise<void> {
  try {
    await chrome.storage.session.set({ [profileUri]: profile });
  } catch {
    // best-effort only: a failed cache write just means we re-sign next load.
  }
}

// The content script runs in the ISOLATED world: there is no window.ethereum
// here (that only exists in the MAIN world, reachable via callInjected/bridge.ts),
// so we cannot hold a live wallet Signer for the 0G reads below. Both
// createZeroGStorageBackend()'s get() (download) and createZeroGBroker()'s
// signer param structurally require `Wallet | JsonRpcSigner` (see those
// modules' `ZeroGSigner` type) -- a bare `JsonRpcProvider` or `VoidSigner`
// does NOT satisfy that type (verified: both fail tsc with "missing
// properties from type Wallet" / "refers to a different private member").
// `provider.getSigner()` returns a real `JsonRpcSigner`, so it type-checks
// cleanly, and -- since CONFIG.zerogRpc is a public RPC endpoint with no
// locally-managed accounts, not a wallet-backed node -- it simply rejects at
// call time, which withFallback below catches like any other live-path
// failure. We never construct or fabricate a private key.
async function readOnlySigner(rpcUrl: string) {
  return new JsonRpcProvider(rpcUrl).getSigner();
}

// No CONFIG slot exists yet for a default 0G Compute inference provider
// address (see .env.example: scripts/try-inference.ts's PROVIDER_ADDRESS is a
// manual, node-only env var read from process.env for a one-off script, not
// part of the client bundle config in src/config.ts). Live inference below
// attempts with this placeholder; the call is expected to reject in this
// context regardless (no funded ledger/signer -- see readOnlySigner above),
// so the exact address does not change the outcome. getSpec's fixture
// fallback is guaranteed either way (see resolveSpec below).
const ZEROG_INFERENCE_PROVIDER = '';

async function loadLiveProfile(): Promise<PersonaProfile> {
  const sepoliaProvider = new JsonRpcProvider(CONFIG.sepoliaRpc);
  const { profileUri } = await readProfilePointer(CONFIG.ensName, sepoliaProvider);
  if (!profileUri) throw new Error('ensight: nessun puntatore profilo su ENS');

  const cached = await getCachedProfile(profileUri);
  if (cached) return cached;

  const sig = await callInjected<string>('personal_sign', [SIGN_MESSAGE]);
  const key = await deriveKey(sig);
  const signer = await readOnlySigner(CONFIG.zerogRpc);
  const backend = createZeroGStorageBackend(signer);
  const profile = await loadProfileFromZeroG(profileUri, key, backend);

  await setCachedProfile(profileUri, profile);
  return profile;
}

// Dev/demo: import statico dei profili persona da demo/personas, usato come
// fallback garantito quando il percorso live (ENS/0G) fallisce per qualsiasi
// motivo (rete, firma rifiutata, nessun puntatore ancora pubblicato, ...).
async function loadProfile(persona: PersonaKey): Promise<PersonaProfile> {
  return resolveProfile({
    loadLiveProfile,
    loadStaticProfile: async () => staticPersonaProfile(persona)
  });
}

// ---- live UISpec path (0G Compute), with a guaranteed fixture fallback ----

const requestLiveSpec: SpecProvider = async (graph, profile) => {
  const signer = await readOnlySigner(CONFIG.zerogRpc);
  const broker = createZeroGBroker(signer, ZEROG_INFERENCE_PROVIDER);
  return requestUISpec(graph, profile, broker);
};

async function enable() {
  const persona = await activePersona();
  const profile = await loadProfile(persona);
  const getSpec = resolveSpec({
    requestLiveSpec,
    getFixtureSpec: async () => fixtureFor(location.href, persona)
  });
  adaptedRoot = await adaptPage(document, profile, getSpec);
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
