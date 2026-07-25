// ISOLATED world: the 0G Storage SDK runs here — see node-shims.ts. Must stay the first import.
import './node-shims';
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
import { browserSdkLoader, createZeroGStorageBackend, loadProfile as loadProfileFromZeroG } from '../services/zerog-storage';
import { requestUISpec, type Broker } from '../services/zerog-compute';
import { deriveKey, SIGN_MESSAGE } from '../core/crypto';

let adaptedRoot: HTMLElement | null = null;
const originals: HTMLElement[] = [];

// Inietta injected.ts nel MAIN world (fuori dal contesto ISOLATED del content
// script) cosicché possa accedere a window.ethereum. Comunica col content
// script via bridge.ts (window.postMessage, protocollo { source:'ensight' }).
(function injectMainWorldScript() {
  const s = document.createElement('script');
  // MUST be a module: the bundled injected.js imports its shared chunks
  // (ethers, config, zerog-compute) with static `import` statements, so loading
  // it as a classic script fails with "Cannot use import statement outside a
  // module" and the MAIN-world message handler never registers — every
  // callInjected() then goes unanswered. crxjs lists those chunks in
  // web_accessible_resources, so the imports resolve from the page.
  s.type = 'module';
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

async function loadLiveProfile(): Promise<PersonaProfile> {
  const sepoliaProvider = new JsonRpcProvider(CONFIG.sepoliaRpc);
  const { profileUri } = await readProfilePointer(CONFIG.ensName, sepoliaProvider);
  if (!profileUri) throw new Error('ensight: nessun puntatore profilo su ENS');

  const cached = await getCachedProfile(profileUri);
  if (cached) return cached;

  const sig = await callInjected<string>('personal_sign', [SIGN_MESSAGE]);
  const key = await deriveKey(sig);
  // Download-only backend: reading a blob off 0G Storage needs no signature
  // (only uploading does), which is what makes this path viable from the
  // ISOLATED world, where there is no window.ethereum and so no wallet signer.
  // The `/browser` SDK build is the one demo/onboarding.tsx proved live.
  const backend = createZeroGStorageBackend(
    null,
    { evmRpc: CONFIG.zerogRpc, indexerRpc: CONFIG.zerogIndexer },
    browserSdkLoader
  );
  const profile = await loadProfileFromZeroG(profileUri, key, backend);

  await setCachedProfile(profileUri, profile);
  return profile;
}

// Dev/demo: import statico dei profili persona da demo/personas, usato come
// fallback garantito quando il percorso live (ENS/0G) fallisce per qualsiasi
// motivo (rete, firma rifiutata, nessun puntatore ancora pubblicato, ...).
// The fallbacks are deliberately silent as far as the UI goes — the demo must
// never break — but a silent fallback is indistinguishable from a working live
// path, which makes "is this really reading ENS/0G?" unanswerable while
// demoing. So each path says which one won, and why, on the page console.
async function loadProfile(persona: PersonaKey): Promise<PersonaProfile> {
  return resolveProfile({
    loadLiveProfile: async () => {
      try {
        const profile = await loadLiveProfile();
        console.info('[ENSight] profilo: LIVE (puntatore ENS -> blob cifrato su 0G Storage)');
        return profile;
      } catch (err) {
        console.warn(`[ENSight] profilo: FALLBACK a "${persona}" statica —`, err);
        throw err;
      }
    },
    loadStaticProfile: async () => staticPersonaProfile(persona)
  });
}

// ---- live UISpec path (0G Compute), with a guaranteed fixture fallback ----

// The 0G Compute SDK needs a real wallet Signer (it pays the provider out of
// an on-chain ledger and signs each request's headers), and a wallet only
// exists in the MAIN world. So the broker itself lives in injected.ts and we
// reach it over the same postMessage bridge used for personal_sign/ens_setText:
// this `Broker` just forwards the prompt and returns the model's raw reply.
// buildMessages/extractJson/UISpec validation all stay here, inside
// requestUISpec, so the untrusted page context never decides what is valid.
const bridgeBroker: Broker = {
  chat: (messages) => callInjected<string>('zerog_chat', [messages])
};

const requestLiveSpec: SpecProvider = async (graph, profile) => {
  // Without a provider address there is nothing to call: fail fast so
  // resolveSpec drops to the fixture instead of paying for a round trip to a
  // wallet prompt that cannot succeed.
  if (!CONFIG.zerogInferenceProvider) {
    throw new Error('ensight: VITE_ZEROG_INFERENCE_PROVIDER non configurato, uso la fixture');
  }
  return requestUISpec(graph, profile, bridgeBroker);
};

async function enable() {
  const persona = await activePersona();
  const profile = await loadProfile(persona);
  const getSpec = resolveSpec({
    requestLiveSpec: async (graph, profile) => {
      try {
        const spec = await requestLiveSpec(graph, profile);
        console.info('[ENSight] UISpec: LIVE (inferenza 0G Compute)');
        return spec;
      } catch (err) {
        console.warn('[ENSight] UISpec: FALLBACK alla fixture pre-calcolata —', err);
        throw err;
      }
    },
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
