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
// IDKitRequestWidget + an rp_context signed by a LOCAL NODE SERVER
// (scripts/onboarding-server.mjs), fetched same-origin over POST /rp-context
// ---------------------------------------------------------------------------
// History (see git log / earlier revisions of this comment for the full
// blow-by-blow): the World Developer Portal now provisions World ID 4.0
// apps. An earlier pass of this file pinned @worldcoin/idkit@2.4.2 (the last
// release with the simple client-only `IDKitWidget` render-prop API) because
// the installed v4.2.1 has NO `IDKitWidget` export and its widget/hook API
// (`IDKitRequestWidget`/`useIDKitRequest`) requires a mandatory
// `rp_context: { rp_id, nonce, created_at, expires_at, signature }`. The user
// then created a real World ID 4.0 app + on-chain-registered RP and decided
// to do REAL v4 verification, so @worldcoin/idkit is back to 4.2.1
// (package.json).
//
// A next pass tried signing rp_context CLIENT-SIDE (in this file) via
// `signRequest()` from `@worldcoin/idkit/signing` - this was WRONG and threw
// at runtime: signRequest has a hard guard
// (node_modules/@worldcoin/idkit-server/dist/index.js, isServerEnvironment())
// that throws "signRequest can only be used in Node.js environments ..." the
// instant it detects it is not running under Node/Deno/Bun. This is
// deliberate (it exists specifically to stop exactly what that pass did: a
// signing key living in a browser bundle), not a bug and not something a
// build/bundler trick can route around. The World Developer Portal's hosted
// proof-context endpoint was also probed directly (POST, several body
// shapes) and only returns app metadata (app_id, rp_id, name, logos,
// action) - not a signed context - so it is not a hosted signer either.
//
// The fix: scripts/onboarding-server.mjs is a tiny local Node http server
// that serves this demo/ directory AND exposes POST /rp-context, which runs
// the REAL signRequest() (happily, since it is actually Node) and returns
// the signed context as JSON. This file just fetches it same-origin - see
// buildRpContext() below. The RP signing key never enters the browser bundle
// at all now: it is read by scripts/onboarding-server.mjs from
// WORLD_RP_SIGNING_KEY (env or a repo-root .env - deliberately NOT
// VITE_-prefixed, see .env.example), and demo/onboarding.tsx never
// references it. `npx grep`-style verification of the built
// demo/onboarding.js for any trace of the key/env name is part of this
// task's verification step - see task-16-partB-report.md.
//
//   DEMO-ONLY CAVEAT (still applies, just relocated): the World ID app/RP
//   behind this demo is a disposable, throwaway one whose key gets
//   rotated/revoked after use. A real product still signs rp_context on a
//   backend server - this local dev server IS that backend, just running on
//   localhost instead of a deployed host, which is appropriate for a
//   developer-only manual E2E harness but would need to move to a real
//   deployed service (with real access control) for anything user-facing.
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
// The signed `action` MUST exactly match the widget's own `action` prop (the
// RP signature covers the action per idkit-server's
// `computeRpSignatureMessage` message format) - buildRpContext() sends
// CONFIG.worldAction in the POST body and the widget below reads the same
// CONFIG.worldAction for its `action` prop.
//
// idkit v4 is a React package (uses WASM internally via idkit-core) and this
// repo only installs preact - the react->preact/compat alias in
// scripts/build-onboarding.mjs is required. This was verified to work back
// in the FIRST Part B pass, before the v2 detour: a standalone
// IDKitRequestWidget smoke build bundled cleanly under that alias (WASM
// chunk included, ~869 KB), with no unresolved react/react-dom imports.
// ---------------------------------------------------------------------------
// UI layer: this file owns the flow (the five handlers and their state) and
// nothing else. Presentation lives in demo/onboarding-ui.tsx, pure helpers in
// demo/onboarding-logic.ts, and styling in demo/onboarding.css — which is
// linked from onboarding.html rather than imported here, because
// scripts/build-onboarding.mjs pins a single `onboarding.js` output and would
// emit an imported stylesheet as an unreferenced hashed asset.
// ---------------------------------------------------------------------------

import { render } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { ethers } from 'ethers';
import type { BrowserProvider, JsonRpcSigner } from 'ethers';
import { IDKitRequestWidget, orbLegacy, IDKitErrorCodes } from '@worldcoin/idkit';
import type { IDKitResult, IDKitDebugReport, RpContext } from '@worldcoin/idkit';
import { CONFIG } from '../src/config';
import { SIGN_MESSAGE, deriveKey } from '../src/core/crypto';
import { attestationFromProof } from '../src/services/world-id';
import { createZeroGStorageBackend, storeProfile } from '../src/services/zerog-storage';
import type { ZeroGStorageSdkLoader } from '../src/services/zerog-storage';
import type { PersonaProfile } from '../src/core/types';
import { SEPOLIA_CHAIN_HEX, ZEROG_CHAIN_HEX, preflightIssues, type PreflightIssue } from './onboarding-logic';
import { MastheadMeta, Stepper, StepCard, Artifact, LogPanel, ErrorBlock, ProfileForm, Summary, ReadOnlyNote, PreflightStrip } from './onboarding-ui';

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
  { n: 1, label: 'Wallet' },
  { n: 2, label: 'Human' },
  { n: 3, label: 'Profile' },
  { n: 4, label: 'Encrypt' },
  { n: 5, label: 'ENS' }
];

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

function App() {
  const [step, setStep] = useState<StepNum>(1);
  const [furthest, setFurthest] = useState<StepNum>(1);
  const [chainId, setChainId] = useState<string | null>(null);

  // Forward movement always goes through here so `furthest` can never fall
  // behind `step` — the stepper uses it to decide which steps are reachable.
  function advance(n: StepNum): void {
    setStep(n);
    setFurthest(f => (n > f ? n : f));
  }

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([
    'Ready. Click "Connect wallet" to begin (requires MetaMask, served over http://localhost).'
  ]);
  const [errors, setErrors] = useState<Record<StepNum, unknown>>({ 1: null, 2: null, 3: null, 4: null, 5: null });

  const [preflight, setPreflight] = useState<PreflightIssue[]>([]);

  // Probes the setup once, before anything is clicked. The signer check is a
  // bare OPTIONS: scripts/onboarding-server.mjs answers it 204 without signing
  // anything, so this costs a round trip and has no side effects — whereas a
  // POST would mint an rp_context nobody uses.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let rpContextOk = false;
      try {
        const res = await fetch('/rp-context', { method: 'OPTIONS' });
        rpContextOk = res.status === 204;
      } catch {
        rpContextOk = false;
      }
      if (cancelled) return;
      setPreflight(preflightIssues({
        hasEthereum: Boolean((window as any).ethereum),
        rpContextOk,
        ensName: CONFIG.ensName,
        worldAppId: CONFIG.worldAppId,
        worldAction: CONFIG.worldAction
      }));
    })();
    return () => { cancelled = true; };
  }, []);

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

  // Keeps the network badge honest. The wizard switches chains twice
  // (0G Galileo for the upload, back to Sepolia for the ENS write), and
  // MetaMask can also be switched by hand mid-run.
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    const read = () => eth.request({ method: 'eth_chainId' }).then(setChainId).catch(() => {});
    const onChanged = (id: string) => setChainId(id);
    read();
    eth.on?.('chainChanged', onChanged);
    return () => eth.removeListener?.('chainChanged', onChanged);
  }, [address]);

  // Lets scripts/preview-onboarding.mjs reach a step that would otherwise need
  // the World ID simulator. Test seam only — nothing in the flow calls it.
  useEffect(() => {
    (window as any).__ensightGoToStep = (n: StepNum) => advance(n);
  }, []);

  // Renders the masthead metadata into the static header (demo/onboarding.html
  // provides #masthead-meta) since that markup lives outside the #app mount.
  useEffect(() => {
    const slot = document.getElementById('masthead-meta');
    if (slot) render(<MastheadMeta ensName={CONFIG.ensName} chainId={chainId} address={address} />, slot);
  }, [chainId, address]);

  function appendLog(line: string): void {
    setLog(l => [...l, line]);
  }

  function logError(context: string, err: unknown): unknown {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(`ERROR (${context}): ${message}`);
    return err;
  }

  function setError(n: StepNum, error: unknown): void {
    setErrors(e => ({ ...e, [n]: error }));
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
      advance(2);
    } catch (err) {
      setError(1, logError('connect', err));
    } finally {
      setBusy(false);
    }
  }

  // ---- Step 2: Verify human (World ID 4.0, IDKitRequestWidget - see header comment) ----
  // Fetches a freshly-signed rp_context from the local Node signing server
  // (scripts/onboarding-server.mjs's POST /rp-context - see header comment
  // for why signing cannot happen in this browser bundle) and opens the
  // widget. Re-fetched on every click so the nonce/TTL are always fresh, in
  // case a previous attempt's context expired.
  async function openWorldWidget(): Promise<void> {
    setError(2, null);
    setBusy(true);
    try {
      appendLog('> POST /rp-context { action } [signed by scripts/onboarding-server.mjs, Node-side]');
      const res = await fetch('/rp-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: CONFIG.worldAction })
      });
      if (!res.ok) {
        throw new Error(`rp-context signer HTTP ${res.status} - is scripts/onboarding-server.mjs running? (node scripts/onboarding-server.mjs)`);
      }
      const context = (await res.json()) as RpContext;
      appendLog(`rp_context received (rp_id=${context.rp_id}, nonce=${context.nonce.slice(0, 10)}...)`);
      setRpContext(context);
      setWorldOpen(true);
    } catch (err) {
      setError(2, logError('world sign', err));
    } finally {
      setBusy(false);
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
      advance(3);
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
    advance(4);
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
      advance(5);
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

  // Back navigation is read-only: a step behind `furthest` only shows what it
  // already produced and re-runs nothing (see the plan's "Back navigation"
  // section). `furthest` never exceeds the current step's own number until
  // that step's advance() fires, so this is always false for the furthest
  // step itself - in particular, step 5 stays interactive for as long as it
  // is the furthest step, which is exactly the case (humanTxHash set,
  // profileTxHash still null) where the retry guard in handleWriteEns must
  // still be reachable from a real button click.
  const readOnly = step < furthest;

  return (
    <>
      <PreflightStrip issues={preflight} />
      <Stepper steps={STEPS} current={step} furthest={furthest} busy={busy} onSelect={n => setStep(n as StepNum)} />

      {step === 1 && (
        <StepCard n={1} busy={busy} title="Connect your wallet"
          why="The same wallet signs the key that encrypts your profile and, at the end, the two ENS records that point at it.">
          {readOnly ? (
            <ReadOnlyNote furthest={furthest} />
          ) : (
            <button class="btn" onClick={handleConnect} disabled={busy}>
              {busy ? 'Connecting…' : 'Connect wallet'}
            </button>
          )}
          {address && <Artifact label="Address" value={address} />}
          <ErrorBlock error={errors[1]} onRetry={handleConnect} />
        </StepCard>
      )}

      {step === 2 && (
        <StepCard n={2} busy={busy} title="Prove you are a person"
          why="One World ID proof, so a profile belongs to one human. No personal data leaves your device — only a nullifier, which cannot be traced back to you.">
          {readOnly ? (
            <ReadOnlyNote furthest={furthest} />
          ) : (
            <button class="btn" onClick={openWorldWidget} disabled={busy || worldOpen}>
              Verify with World ID
            </button>
          )}
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
          {attestation && <Artifact label="Attestation" value={attestation} />}
          <ErrorBlock error={errors[2]} onRetry={openWorldWidget} />
        </StepCard>
      )}

      {step === 3 && (
        <StepCard n={3} busy={busy} title="Describe how you read"
          why="These choices are what the AI adapts every page to. They are encrypted before they leave this page.">
          <ProfileForm
            profile={profile}
            domainsInput={domainsInput}
            onProfileChange={setProfile}
            onDomainsChange={setDomainsInput}
            onSubmit={handleProfileNext}
            busy={busy}
          />
          <ErrorBlock error={errors[3]} onRetry={null} />
        </StepCard>
      )}

      {step === 4 && (
        <StepCard n={4} busy={busy} title="Encrypt and upload"
          why={<>Your wallet signs a fixed message; that signature derives an AES-GCM key that never leaves this page. Only the ciphertext goes to 0G Storage. MetaMask will switch to 0G Galileo (chain {CONFIG.zerogChainId}) first.</>}>
          {readOnly ? (
            <ReadOnlyNote furthest={furthest} />
          ) : (
            <button class="btn" onClick={handleEncryptUpload} disabled={busy}>
              {busy ? 'Working…' : 'Encrypt & upload'}
            </button>
          )}
          {profileUri && <Artifact label="0G root hash" value={profileUri} />}
          <ErrorBlock error={errors[4]} onRetry={handleEncryptUpload} />
        </StepCard>
      )}

      {step === 5 && !(humanTxHash && profileTxHash) && (
        <StepCard n={5} busy={busy} title="Write it to ENS"
          why={<>Two <code>setText</code> records on {CONFIG.ensName}, back on Sepolia: the attestation and the pointer. Both are public; neither reveals the profile.</>}>
          {readOnly ? (
            <ReadOnlyNote furthest={furthest} />
          ) : (
            <button class="btn" onClick={handleWriteEns} disabled={busy}>
              {busy ? 'Working…' : 'Write ENS records'}
            </button>
          )}
          {humanTxHash && <Artifact label="Human tx" value={humanTxHash} href={`https://sepolia.etherscan.io/tx/${humanTxHash}`} />}
          {profileTxHash && <Artifact label="Profile tx" value={profileTxHash} href={`https://sepolia.etherscan.io/tx/${profileTxHash}`} />}
          <ErrorBlock error={errors[5]} onRetry={handleWriteEns} />
        </StepCard>
      )}

      {step === 5 && humanTxHash && profileTxHash && (
        <Summary
          ensName={CONFIG.ensName}
          recordKeys={CONFIG.recordKeys}
          attestation={attestation}
          profileUri={profileUri}
          humanTxHash={humanTxHash}
          profileTxHash={profileTxHash}
        />
      )}

      <LogPanel lines={log} />
    </>
  );
}

const root = document.getElementById('app');
if (root) render(<App />, root);
