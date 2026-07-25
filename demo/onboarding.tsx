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
// World ID step (Step 2): live IDKitWidget - @worldcoin/idkit PINNED to 2.4.2
// ---------------------------------------------------------------------------
// The task brief describes `<IDKitWidget app_id action onSuccess>` with a
// render-prop child `({open}) => <button onClick={open}>` and a proof object
// exposing `nullifier_hash` directly. There is NO idkit v3 - the package
// jumps 2.x -> 4.x. `npm install @worldcoin/idkit` (unpinned) resolves to
// 4.x, which has NO `IDKitWidget` export at all: its widget/hook API
// (`IDKitRequestWidget`/`useIDKitRequest`) requires a mandatory
// `rp_context: { rp_id, nonce, created_at, expires_at, signature }` whose
// `signature` MUST be produced server-side with a private RP signing key
// (node_modules/@worldcoin/idkit-core/README.md, verbatim: "RP signing is
// intentionally not exposed on the browser global; generate RP signatures
// on your backend"). ENSight has no backend anywhere in this project, so v4
// cannot do live client-only verification here - that was the finding
// written up in an earlier pass of this file (see git history / the
// "FLAGGED DEVIATION" section of task-16-partB-report.md for the full
// investigation) and is why the earlier version of this file used a
// manual-paste fallback instead.
//
// @worldcoin/idkit@2.4.2 (package.json now pins this exact version) is the
// last release with the client-only `IDKitWidget` API the brief assumes:
// exports `IDKitWidget` from `./build/index.js` (verified via
// `node -e "console.log(Object.keys(require('@worldcoin/idkit')))"`), no
// `rp_context`/backend needed, `app_id`/`action`/`onSuccess` config, and a
// render-prop child `({ open }) => JSX.Element` - exactly the shape used
// below. Its `ISuccessResult` (node_modules/@worldcoin/idkit-core/build/
// result-*.d.ts) has `nullifier_hash` directly, so it flows into the real,
// unmodified `attestationFromProof()` (src/services/world-id.ts) with no
// adaptation.
//
// idkit v2 is a React package (framer-motion, @radix-ui/react-dialog,
// @radix-ui/react-toast, zustand internally, on top of the react/react-dom
// peerDependency) and this repo only installs preact - see the
// react->preact/compat alias in scripts/build-onboarding.mjs, which is
// REQUIRED again for this build (it was written for the v4 investigation
// too, but v4's widget was never actually wired in). Verified genuinely: a
// full vite build of a standalone <IDKitWidget> under that alias bundles
// cleanly (no unresolved react/react-dom/framer-motion/@radix-ui/zustand
// imports), AND a jsdom render smoke test actually mounted it and produced
// the expected `<button>Verify with World ID</button>` from the render-prop
// child with no throw - so this is not a preact/compat rendering problem
// either. No react/react-dom devDeps and no fallback were needed.
// ---------------------------------------------------------------------------

import { render } from 'preact';
import { useState, useRef } from 'preact/hooks';
import { ethers } from 'ethers';
import type { BrowserProvider, JsonRpcSigner } from 'ethers';
import { IDKitWidget, type ISuccessResult, type IErrorState } from '@worldcoin/idkit';
import { CONFIG } from '../src/config';
import { SIGN_MESSAGE, deriveKey } from '../src/core/crypto';
import { attestationFromProof } from '../src/services/world-id';
import { createZeroGStorageBackend, storeProfile } from '../src/services/zerog-storage';
import type { ZeroGStorageSdkLoader } from '../src/services/zerog-storage';
import type { PersonaProfile } from '../src/core/types';

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

  // ---- Step 2: Verify human (live IDKitWidget - see header comment) ----
  function handleWorldSuccess(proof: ISuccessResult): void {
    setError(2, null);
    try {
      const att = attestationFromProof(proof);
      setAttestation(att);
      appendLog(`Attestation: ${att}`);
      setStep(3);
    } catch (err) {
      setError(2, logError('verify', err));
    }
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
            World ID staging (simulator) - <code>@worldcoin/idkit@2.4.2</code>. Opens the real widget; use the
            World App simulator (Developer Portal, staging app) to complete verification without a physical Orb.
          </p>
          <IDKitWidget
            app_id={CONFIG.worldAppId as `app_${string}`}
            action={CONFIG.worldAction}
            onSuccess={handleWorldSuccess}
            onError={(err: IErrorState) => setError(2, `IDKit error: ${JSON.stringify(err)}`)}
          >
            {({ open }: { open: () => void }) => (
              <button onClick={open} disabled={busy}>
                Verify with World ID
              </button>
            )}
          </IDKitWidget>
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
