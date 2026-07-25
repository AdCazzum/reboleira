// Manual browser harness (Task 16, Part B) for the REAL end-to-end ENSight
// onboarding flow: connect wallet -> verify human -> profile form -> encrypt
// & upload to 0G Storage -> write pointer + attestation to ENS on Sepolia.
//
// This is a standalone http://localhost page (NOT a packed extension page)
// so MetaMask injects window.ethereum and we can hold a live ethers
// BrowserProvider/Signer directly - see the module doc comment in
// scripts/build-onboarding.mjs and demo/wallet-test.ts for why a packed
// chrome-extension:// page cannot do this (no injected window.ethereum, and
// a live Signer cannot cross the extension message bridge).
//
// Uses the REAL src/core/crypto.ts, src/services/world-id.ts,
// src/services/zerog-storage.ts and src/config.ts - no copies, no mocks.
// The ENS write mirrors src/content/injected.ts's `ens_setText` handler
// directly with the connected signer (NOT via writeProfilePointer(), which
// routes through callInjected() - the postMessage bridge to a content
// script that does not exist on this plain page).
//
// ---------------------------------------------------------------------------
// World ID step (Step 2): REAL World ID 4.0 verification - idkit v4.2.1,
// IDKitRequestWidget + a client-signed rp_context (demo-only - see below)
// ---------------------------------------------------------------------------
// History (see git log / earlier revisions of this comment for the full
// blow-by-blow): the World Developer Portal now provisions World ID 4.0
// apps. An earlier pass of this file pinned @worldcoin/idkit@2.4.2 (the last
// release with the simple client-only `IDKitWidget` render-prop API) because
// the installed v4.2.1 has NO `IDKitWidget` export and its widget/hook API
// (`IDKitRequestWidget`/`useIDKitRequest`) requires a mandatory
// `rp_context: { rp_id, nonce, created_at, expires_at, signature }` whose
// `signature` the docs (and node_modules/@worldcoin/idkit-core/README.md,
// verbatim: "RP signing is intentionally not exposed on the browser global;
// generate RP signatures on your backend") say must come from a backend -
// which ENSight does not have.
//
// The user then created a real World ID 4.0 app + on-chain-registered RP in
// the Developer Portal and decided to do REAL v4 verification instead of the
// v2 widget or a manual-paste fallback. @worldcoin/idkit is back to 4.2.1
// (package.json). For this backend-less localhost demo, rp_context is
// signed CLIENT-SIDE with the RP's private signing key, using the pure-JS
// (no WASM) `signRequest()` from the `@worldcoin/idkit/signing` subpath
// (confirmed: `@worldcoin/idkit-core/signing` -> `@worldcoin/idkit-server`,
// "Signs an RP request using pure JS (no WASM required) ... Ethereum EIP-191
// message signing").
//
//   DEMO-ONLY, NOT A PRODUCTION PATTERN: signing rp_context in the browser
//   means the RP signing key ends up inlined into demo/onboarding.js by
//   scripts/build-onboarding.mjs (same import.meta.env mechanism as every
//   other VITE_ var - see .env.example). This is acceptable ONLY because the
//   World ID app/RP behind this demo is a disposable, throwaway one whose
//   key gets rotated/revoked after use. A real product signs rp_context on a
//   backend server that holds the key, never in a client bundle.
//
// Verified against the ACTUALLY INSTALLED types (not assumed from docs),
// since the installed `IDKitResult` (`@worldcoin/idkit`, re-exported from
// idkit-core) is `IDKitResultV3 | IDKitResultV4 | IDKitResultSession` - a
// union of OBJECTS each with a `responses: ResponseItem*[]` array field, NOT
// a bare `ResponseItemV4[]` array itself. `orbLegacy` presets are documented
// as "This preset only returns World ID 3.0 proofs", so with
// `preset={orbLegacy(...)}` the actual result is `IDKitResultV3`-shaped at
// runtime, but the TYPE surfaced to `onSuccess` is still the full 3-way
// union (IDKitRequestWidget's prop types aren't narrowed by preset). Both V3
// and V4 response items expose `.nullifier` (hex); only the session variant
// (`ResponseItemSession`) does not (it has `session_nullifier: string[]`
// instead) - IDKitRequestWidget (the non-session request widget used here)
// can never actually produce a session result, so `'nullifier' in item`
// narrows the type safely and correctly (see extractNullifier() below)
// without an unsafe cast, while staying honest about the full union type
// the SDK declares.
//
// `signRequest({ signingKeyHex, action? }) -> { sig, nonce, createdAt,
// expiresAt }` (node_modules/@worldcoin/idkit-server/dist/index.d.ts) -
// mapped 1:1 onto RpContext's snake_case fields below. The signed `action`
// MUST exactly match the widget's own `action` prop (the RP signature
// covers the action per idkit-server's `computeRpSignatureMessage` message
// format), so both read from the same `CONFIG.worldAction`.
//
// idkit v4 is a React package (uses WASM internally via idkit-core) and this
// repo only installs preact - the react->preact/compat alias in
// scripts/build-onboarding.mjs is required. This was verified to work back
// in the FIRST Part B pass, before the v2 detour: a standalone
// IDKitRequestWidget smoke build bundled cleanly under that alias (WASM
// chunk included, ~869 KB), with no unresolved react/react-dom imports.
// ---------------------------------------------------------------------------

import { render } from 'preact';
import { useState, useRef } from 'preact/hooks';
import { ethers } from 'ethers';
import type { BrowserProvider, JsonRpcSigner } from 'ethers';
import { IDKitRequestWidget, orbLegacy, IDKitErrorCodes } from '@worldcoin/idkit';
import type { IDKitResult, IDKitDebugReport, RpContext } from '@worldcoin/idkit';
import { signRequest } from '@worldcoin/idkit/signing';
import { CONFIG } from '../src/config';
import { SIGN_MESSAGE, deriveKey } from '../src/core/crypto';
import { attestationFromProof } from '../src/services/world-id';
import { createZeroGStorageBackend, storeProfile } from '../src/services/zerog-storage';
import type { ZeroGStorageSdkLoader } from '../src/services/zerog-storage';
import type { PersonaProfile } from '../src/core/types';

// Narrows IDKitResult's response item union down to the variants that carry
// `.nullifier` (V3/V4 uniqueness proofs), excluding the session variant
// (`session_nullifier: string[]`) that IDKitRequestWidget never actually
// produces. See the header comment above for why this is safe.
function extractNullifier(result: IDKitResult): string {
  const item = result.responses[0];
  if (!item) throw new Error('World ID result has no responses');
  if ('nullifier' in item) return item.nullifier;
  throw new Error('World ID result has no nullifier (got a session proof, which IDKitRequestWidget should never produce)');
}

type StepNum = 1 | 2 | 3 | 4 | 5;
const STEPS: { n: StepNum; label: string }[] = [
  { n: 1, label: 'Connect' },
  { n: 2, label: 'Verify human' },
  { n: 3, label: 'Profile' },
  { n: 4, label: 'Encrypt & upload' },
  { n: 5, label: 'Write ENS' }
];

// CONFIG.zerogChainId (16602) as 0x-hex; Sepolia's well-known chainId (11155111).
const ZEROG_CHAIN_HEX = '0x40DA';
const SEPOLIA_CHAIN_HEX = '0xAA36A7';

async function switchChain(chainIdHex: string, addParams?: Record<string, unknown>): Promise<void> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error('window.ethereum not found');
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
  } catch (err: any) {
    const code = err?.code ?? err?.data?.originalError?.code;
    if (code === 4902 && addParams) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [addParams] });
      // wallet_addEthereumChain does not reliably guarantee the wallet
      // actually switched to the newly-added chain afterwards (behavior
      // differs by wallet/version) - re-read the active chain and fail
      // loudly with a clear instruction rather than silently proceeding to
      // send a tx on the wrong network.
      const active = (await eth.request({ method: 'eth_chainId' })) as string;
      if (active.toLowerCase() !== chainIdHex.toLowerCase()) {
        throw new Error(
          `Wallet added chain ${chainIdHex} but is still on ${active} - please switch to it manually in MetaMask and retry.`
        );
      }
    } else {
      throw err;
    }
  }
}

function emptyProfile(): PersonaProfile {
  return {
    version: 1,
    language: 'en',
    readingLevel: 'standard',
    tone: 'neutral',
    accessibility: { dyslexiaFriendly: false, highContrast: false, largeText: false, reduceClutter: false },
    expertiseDomains: []
  };
}

function Stepper({ step }: { step: StepNum }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      {STEPS.map(s => (
        <div
          key={s.n}
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            fontSize: 13,
            background: s.n === step ? '#111' : s.n < step ? '#137333' : '#eee',
            color: s.n === step || s.n < step ? '#fff' : '#333'
          }}
        >
          {s.n}. {s.label}
        </div>
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <p style={{ color: '#a50e0e', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>Error: {message}</p>;
}

function App() {
  const [step, setStep] = useState<StepNum>(1);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([
    'Ready. Click "Connect wallet" to begin (requires MetaMask, served over http://localhost).'
  ]);
  const [errors, setErrors] = useState<Record<StepNum, string | null>>({ 1: null, 2: null, 3: null, 4: null, 5: null });

  // Live ethers handles - held in refs (not state: they are not meant to
  // trigger re-renders, and ethers Provider/Signer instances are not usefully
  // comparable/serializable).
  const providerRef = useRef<BrowserProvider | null>(null);
  const signerRef = useRef<JsonRpcSigner | null>(null);

  const [address, setAddress] = useState<string | null>(null);

  const [attestation, setAttestation] = useState<string | null>(null);
  const [worldOpen, setWorldOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);

  const [profile, setProfile] = useState<PersonaProfile>(emptyProfile());
  const [domainsInput, setDomainsInput] = useState('');

  const [profileUri, setProfileUri] = useState<string | null>(null);

  const [humanTxHash, setHumanTxHash] = useState<string | null>(null);
  const [profileTxHash, setProfileTxHash] = useState<string | null>(null);

  function appendLog(line: string): void {
    setLog(l => [...l, line]);
  }

  function logError(context: string, err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(`ERROR (${context}): ${message}`);
    return message;
  }

  function setError(n: StepNum, message: string | null): void {
    setErrors(e => ({ ...e, [n]: message }));
  }

  async function refreshSigner(): Promise<JsonRpcSigner> {
    const eth = (window as any).ethereum;
    const provider = new ethers.BrowserProvider(eth);
    const signer = await provider.getSigner();
    providerRef.current = provider;
    signerRef.current = signer;
    return signer;
  }

  // ---- Step 1: Connect ----
  async function handleConnect(): Promise<void> {
    setBusy(true);
    setError(1, null);
    try {
      const eth = (window as any).ethereum;
      if (!eth) throw new Error('window.ethereum not found - install/enable MetaMask and reload this page over http://localhost');
      appendLog('> provider.send("eth_requestAccounts", [])');
      const provider = new ethers.BrowserProvider(eth);
      await provider.send('eth_requestAccounts', []);
      const signer = await provider.getSigner();
      providerRef.current = provider;
      signerRef.current = signer;
      const addr = await signer.getAddress();
      setAddress(addr);
      appendLog(`Connected: ${addr}`);
      setStep(2);
    } catch (err) {
      setError(1, logError('connect', err));
    } finally {
      setBusy(false);
    }
  }

  // ---- Step 2: Verify human (World ID 4.0, IDKitRequestWidget - see header comment) ----
  // Signs a fresh rp_context client-side (DEMO-ONLY, see header comment) and
  // opens the widget. Re-signed on every click so the nonce/TTL are always
  // fresh, in case a previous attempt's context expired.
  function openWorldWidget(): void {
    setError(2, null);
    try {
      const signingKeyHex = import.meta.env.VITE_WORLD_RP_SIGNING_KEY as string;
      if (!signingKeyHex) throw new Error('VITE_WORLD_RP_SIGNING_KEY not set in .env (demo-only RP signing key - see .env.example)');
      if (!CONFIG.worldRpId) throw new Error('VITE_WORLD_RP_ID not set in .env');
      appendLog('> signRequest({ signingKeyHex, action }) [client-side, demo-only]');
      const { sig, nonce, createdAt, expiresAt } = signRequest({
        signingKeyHex,
        action: CONFIG.worldAction
      });
      setRpContext({ rp_id: CONFIG.worldRpId, nonce, created_at: createdAt, expires_at: expiresAt, signature: sig });
      setWorldOpen(true);
    } catch (err) {
      setError(2, logError('world sign', err));
    }
  }

  function handleWorldSuccess(result: IDKitResult): void {
    setError(2, null);
    try {
      const nullifier = extractNullifier(result);
      const att = attestationFromProof({ nullifier_hash: nullifier });
      setAttestation(att);
      appendLog(`World ID protocol_version=${result.protocol_version}, nullifier=${nullifier}`);
      appendLog(`Attestation: ${att}`);
      setWorldOpen(false);
      setStep(3);
    } catch (err) {
      setError(2, logError('verify', err));
    }
  }

  function handleWorldError(code: IDKitErrorCodes, debugReport?: IDKitDebugReport): void {
    setWorldOpen(false);
    setError(2, logError('world verify', new Error(`${code}${debugReport ? ` - ${JSON.stringify(debugReport)}` : ''}`)));
  }

  // ---- Step 3: Profile form ----
  function updateProfile<K extends keyof PersonaProfile>(key: K, value: PersonaProfile[K]): void {
    setProfile(p => ({ ...p, [key]: value }));
  }
  function updateAccessibility(key: keyof PersonaProfile['accessibility'], value: boolean): void {
    setProfile(p => ({ ...p, accessibility: { ...p.accessibility, [key]: value } }));
  }
  function handleProfileNext(e: Event): void {
    e.preventDefault();
    setError(3, null);
    if (!profile.language.trim()) {
      setError(3, 'Language (BCP-47, e.g. "en") is required.');
      return;
    }
    const domains = domainsInput.split(',').map(s => s.trim()).filter(Boolean);
    const finalProfile: PersonaProfile = { ...profile, expertiseDomains: domains };
    setProfile(finalProfile);
    appendLog(`Profile: ${JSON.stringify(finalProfile)}`);
    setStep(4);
  }

  // ---- Step 4: Encrypt & upload to 0G Storage ----
  async function handleEncryptUpload(): Promise<void> {
    setBusy(true);
    setError(4, null);
    try {
      if (!signerRef.current) throw new Error('Not connected - go back to Step 1');
      appendLog(`Switching wallet to 0G Galileo (${ZEROG_CHAIN_HEX})...`);
      await switchChain(ZEROG_CHAIN_HEX, {
        chainId: ZEROG_CHAIN_HEX,
        chainName: '0G Galileo Testnet',
        rpcUrls: [CONFIG.zerogRpc],
        nativeCurrency: { name: 'OG', symbol: 'OG', decimals: 18 }
      });
      const signer = await refreshSigner();
      appendLog('> signer.signMessage(SIGN_MESSAGE)');
      const sig = await signer.signMessage(SIGN_MESSAGE);
      appendLog('> deriveKey(signature)');
      const key = await deriveKey(sig);
      appendLog('> createZeroGStorageBackend(signer) + storeProfile(profile, key, backend)');
      // The `/browser` subpath's declared types (package.json "exports"
      // -> "./browser".types -> lib.esm/index.d.ts) are structurally close
      // to, but not nominally identical to, the main entry's types
      // (types/index.d.ts) that ZeroGStorageSdkLoader is typed against - a
      // private-field branding mismatch on one internal class
      // (Downloader.symmetricKey), not a real API difference. Both resolve
      // to the same runtime module shape (Indexer/MemData/etc.), so this
      // cast is safe.
      const loadSdk = (() => import('@0gfoundation/0g-storage-ts-sdk/browser')) as unknown as ZeroGStorageSdkLoader;
      const backend = createZeroGStorageBackend(signer, {}, loadSdk);
      const uri = await storeProfile(profile, key, backend);
      setProfileUri(uri);
      appendLog(`0G Storage root hash (uri): ${uri}`);
      setStep(5);
    } catch (err) {
      setError(4, logError('encrypt/upload', err));
    } finally {
      setBusy(false);
    }
  }

  // ---- Step 5: Write ENS (mirrors src/content/injected.ts's ens_setText) ----
  async function handleWriteEns(): Promise<void> {
    setBusy(true);
    setError(5, null);
    try {
      if (!attestation || !profileUri) throw new Error('Missing attestation or profile URI - complete Steps 2 and 4 first');
      appendLog(`Switching wallet to Sepolia (${SEPOLIA_CHAIN_HEX})...`);
      await switchChain(SEPOLIA_CHAIN_HEX);
      const signer = await refreshSigner();
      const provider = providerRef.current!;
      const resolver = await provider.getResolver(CONFIG.ensName);
      if (!resolver) throw new Error(`No resolver found for ${CONFIG.ensName} on Sepolia`);
      const node = ethers.namehash(CONFIG.ensName);
      const iface = new ethers.Interface(['function setText(bytes32 node,string key,string value)']);

      // Retry guard: if a previous attempt already landed the human-record
      // tx (humanTxHash is set), don't re-send it on retry - go straight to
      // the profile record. Makes this step resumable after a failure on
      // the second tx without re-spending testnet gas on the first.
      if (humanTxHash) {
        appendLog(`human tx already confirmed (${humanTxHash}), skipping re-send`);
      } else {
        appendLog(`> setText(${CONFIG.recordKeys.human}, ${attestation})`);
        const tx1 = await signer.sendTransaction({
          to: resolver.address,
          data: iface.encodeFunctionData('setText', [node, CONFIG.recordKeys.human, attestation])
        });
        const rcpt1 = await tx1.wait();
        const hash1 = rcpt1!.hash;
        setHumanTxHash(hash1);
        appendLog(`human tx: ${hash1}`);
      }

      // Symmetric retry guard for the second record, in case a retry is
      // triggered after both already succeeded (e.g. an accidental re-click).
      if (profileTxHash) {
        appendLog(`profile tx already confirmed (${profileTxHash}), skipping re-send`);
      } else {
        appendLog(`> setText(${CONFIG.recordKeys.profile}, ${profileUri})`);
        const tx2 = await signer.sendTransaction({
          to: resolver.address,
          data: iface.encodeFunctionData('setText', [node, CONFIG.recordKeys.profile, profileUri])
        });
        const rcpt2 = await tx2.wait();
        const hash2 = rcpt2!.hash;
        setProfileTxHash(hash2);
        appendLog(`profile tx: ${hash2}`);
      }
    } catch (err) {
      setError(5, logError('ens write', err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <Stepper step={step} />

      {step === 1 && (
        <section>
          <h2>1. Connect wallet</h2>
          <p>
            ENS name to configure: <code>{CONFIG.ensName || '(VITE_ENS_NAME not set in .env)'}</code>
          </p>
          <button onClick={handleConnect} disabled={busy}>
            {busy ? 'Connecting...' : 'Connect wallet'}
          </button>
          {address && <p>Connected address: <code>{address}</code></p>}
          <ErrorBox message={errors[1]} />
        </section>
      )}

      {step === 2 && (
        <section>
          <h2>2. Verify human</h2>
          <p style={{ fontSize: 13, color: '#555' }}>
            World ID 4.0 staging (simulator) - <code>@worldcoin/idkit@4.2.1</code>,{' '}
            <code>IDKitRequestWidget</code>. rp_context is signed client-side with a demo-only RP key (see the
            header comment in this file and <code>.env.example</code>) - never do this in production. Opens the
            real widget; use the World App simulator (Developer Portal, staging app) to complete verification
            without a physical Orb.
          </p>
          <button onClick={openWorldWidget} disabled={busy || worldOpen}>
            Verify with World ID
          </button>
          {rpContext && (
            <IDKitRequestWidget
              open={worldOpen}
              onOpenChange={setWorldOpen}
              app_id={CONFIG.worldAppId as `app_${string}`}
              action={CONFIG.worldAction}
              rp_context={rpContext}
              environment="staging"
              allow_legacy_proofs={true}
              preset={orbLegacy({ signal: address ?? undefined })}
              onSuccess={handleWorldSuccess}
              onError={handleWorldError}
            />
          )}
          {attestation && <p>Attestation: <code>{attestation}</code></p>}
          <ErrorBox message={errors[2]} />
        </section>
      )}

      {step === 3 && (
        <section>
          <h2>3. Profile</h2>
          <form onSubmit={handleProfileNext}>
            <label style={{ display: 'block', marginTop: 8 }}>
              Language (BCP-47)
              <input
                value={profile.language}
                onInput={e => updateProfile('language', (e.currentTarget as HTMLInputElement).value)}
                style={{ display: 'block', width: '100%', boxSizing: 'border-box' }}
              />
            </label>
            <label style={{ display: 'block', marginTop: 8 }}>
              Reading level
              <select
                value={profile.readingLevel}
                onChange={e => updateProfile('readingLevel', (e.currentTarget as HTMLSelectElement).value as PersonaProfile['readingLevel'])}
                style={{ display: 'block', width: '100%' }}
              >
                <option value="simple">simple</option>
                <option value="standard">standard</option>
                <option value="expert">expert</option>
              </select>
            </label>
            <label style={{ display: 'block', marginTop: 8 }}>
              Tone
              <select
                value={profile.tone}
                onChange={e => updateProfile('tone', (e.currentTarget as HTMLSelectElement).value as PersonaProfile['tone'])}
                style={{ display: 'block', width: '100%' }}
              >
                <option value="plain">plain</option>
                <option value="neutral">neutral</option>
                <option value="technical">technical</option>
              </select>
            </label>
            <fieldset style={{ marginTop: 8 }}>
              <legend>Accessibility</legend>
              {(['dyslexiaFriendly', 'highContrast', 'largeText', 'reduceClutter'] as const).map(k => (
                <label key={k} style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    checked={profile.accessibility[k]}
                    onChange={e => updateAccessibility(k, (e.currentTarget as HTMLInputElement).checked)}
                  />{' '}
                  {k}
                </label>
              ))}
            </fieldset>
            <label style={{ display: 'block', marginTop: 8 }}>
              Expertise domains (comma-separated)
              <input
                value={domainsInput}
                onInput={e => setDomainsInput((e.currentTarget as HTMLInputElement).value)}
                placeholder="finance, medicine"
                style={{ display: 'block', width: '100%', boxSizing: 'border-box' }}
              />
            </label>
            <div style={{ marginTop: 12 }}>
              <button type="submit" disabled={busy}>Next</button>
            </div>
          </form>
          <ErrorBox message={errors[3]} />
        </section>
      )}

      {step === 4 && (
        <section>
          <h2>4. Encrypt & upload to 0G Storage</h2>
          <p>
            Signs <code>SIGN_MESSAGE</code>, derives an AES-GCM key, encrypts the profile, and uploads it to
            0G Storage. This sends a transaction on 0G Galileo (chainId {CONFIG.zerogChainId}), so MetaMask
            will be switched to that network first (added automatically if unknown).
          </p>
          <button onClick={handleEncryptUpload} disabled={busy}>
            {busy ? 'Working...' : 'Encrypt & upload'}
          </button>
          {profileUri && <p>0G Storage uri (root hash): <code>{profileUri}</code></p>}
          <ErrorBox message={errors[4]} />
        </section>
      )}

      {step === 5 && (
        <section>
          <h2>5. Write ENS</h2>
          <p>
            Switches MetaMask back to Sepolia, then writes both text records on <code>{CONFIG.ensName}</code>{' '}
            via <code>setText</code>: <code>{CONFIG.recordKeys.human}</code> = attestation,{' '}
            <code>{CONFIG.recordKeys.profile}</code> = 0G uri.
          </p>
          <button onClick={handleWriteEns} disabled={busy}>
            {busy ? 'Working...' : 'Write ENS records'}
          </button>
          {humanTxHash && (
            <p>
              human tx: <a href={`https://sepolia.etherscan.io/tx/${humanTxHash}`} target="_blank" rel="noreferrer">{humanTxHash}</a>
            </p>
          )}
          {profileTxHash && (
            <p>
              profile tx: <a href={`https://sepolia.etherscan.io/tx/${profileTxHash}`} target="_blank" rel="noreferrer">{profileTxHash}</a>
            </p>
          )}
          {humanTxHash && profileTxHash && <p style={{ color: '#137333', fontWeight: 'bold' }}>Onboarding complete.</p>}
          <ErrorBox message={errors[5]} />
        </section>
      )}

      <div
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          background: '#111',
          color: '#0f0',
          padding: '1rem',
          marginTop: '1rem',
          minHeight: '6rem',
          fontFamily: 'ui-monospace, monospace',
          fontSize: '0.8rem',
          borderRadius: 4
        }}
      >
        {log.join('\n')}
      </div>
    </div>
  );
}

const root = document.getElementById('app');
if (root) render(<App />, root);
