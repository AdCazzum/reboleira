import type { Wallet, JsonRpcSigner } from 'ethers';
import type { PersonaProfile } from '../core/types';
import { encryptJson, decryptJson } from '../core/crypto';
export interface StorageBackend { put(blob: string): Promise<string>; get(uri: string): Promise<string>; }
export async function storeProfile(p: PersonaProfile, key: CryptoKey, be: StorageBackend): Promise<string> {
  return be.put(await encryptJson(key, p));
}
export async function loadProfile(uri: string, key: CryptoKey, be: StorageBackend): Promise<PersonaProfile> {
  return decryptJson<PersonaProfile>(key, await be.get(uri));
}

// ---- live 0G Storage backend ----

// NOTE on the signer type: the installed SDK's `Indexer.upload` (see
// node_modules/@0gfoundation/0g-storage-ts-sdk/types/indexer/Indexer.d.ts)
// types its `signer` param as the generic ethers `Signer`. We accept the
// narrower `Wallet | JsonRpcSigner` union here (mirroring zerog-compute.ts's
// `createZeroGBroker`), since both structurally satisfy `Signer` and are
// what our scripts/extension actually construct.
type ZeroGSigner = Wallet | JsonRpcSigner;

// The SDK loader is injectable so callers can swap how the ESM module is
// obtained. The default uses dynamic `import()`, matching the Vite-bundled
// browser extension convention used by zerog-compute.ts. Node-only scripts
// (e.g. scripts/try-storage.ts) that run under `tsx` should inject a
// `createRequire`-based loader instead, since tsx's esbuild loader is known
// to mishandle these 0G SDKs' ESM chunks (see zerog-compute.ts / try-inference.ts
// for the identical workaround).
type SdkModule = typeof import('@0gfoundation/0g-storage-ts-sdk');
export type ZeroGStorageSdkLoader = () => Promise<SdkModule>;
const defaultSdkLoader: ZeroGStorageSdkLoader = () => import('@0gfoundation/0g-storage-ts-sdk');

/**
 * Loader for the SDK's pre-bundled `/browser` build. Browser callers (the
 * content script, demo/onboarding.tsx) should pass this rather than relying on
 * `defaultSdkLoader`: the main entry pulls in transitive Node-oriented deps,
 * while `/browser` is the vendor's own browser bundle.
 *
 * The cast is needed because the `/browser` subpath's declared types
 * (package.json "exports" -> "./browser".types -> lib.esm/index.d.ts) are
 * structurally close to, but not nominally identical to, the main entry's
 * types (types/index.d.ts) that `ZeroGStorageSdkLoader` is typed against — a
 * private-field branding mismatch on one internal class
 * (Downloader.symmetricKey), not a real API difference. Both resolve to the
 * same runtime module shape (Indexer/MemData/etc.).
 */
export const browserSdkLoader = (() =>
  import('@0gfoundation/0g-storage-ts-sdk/browser')) as unknown as ZeroGStorageSdkLoader;

export interface ZeroGStorageOptions {
  evmRpc?: string;
  indexerRpc?: string;
}

const DEFAULT_EVM_RPC = 'https://evmrpc-testnet.0g.ai';
const DEFAULT_INDEXER_RPC = 'https://indexer-storage-testnet-turbo.0g.ai';

/**
 * Builds a `StorageBackend` backed by the real 0G Storage network.
 *
 * Works in BOTH Node and the browser: `get()` downloads via the SDK's
 * `Indexer.downloadToBlob()`, which the vendor documents as "browser and
 * Node.js safe" (the file-based `Indexer.download()` is explicitly Node-only
 * and must not be used here — the extension's content script imports this
 * module, and a `node:fs` import would be replaced by Vite's
 * `__vite-browser-external` stub and throw at call time).
 *
 * `signer` is only needed by `put()`, which submits an on-chain upload
 * transaction. Pass `null` for a download-only backend (the extension's
 * content script has no wallet signer: it runs in the ISOLATED world, where
 * there is no `window.ethereum`) — `put()` then throws instead of failing
 * deep inside the SDK.
 *
 * `put()`/`get()` never touch the SDK at module load time — it is loaded
 * lazily via `loadSdk` on first use (and memoized after that), so importing
 * this module — and running the existing unit tests, which only ever exercise
 * storeProfile/loadProfile against a mock `StorageBackend` — never pulls the
 * SDK (or its network machinery) into the process. `loadSdk` defaults to
 * dynamic `import()` of the main entry; browser callers should pass
 * `browserSdkLoader`.
 */
export function createZeroGStorageBackend(
  signer: ZeroGSigner | null,
  opts?: ZeroGStorageOptions,
  loadSdk: ZeroGStorageSdkLoader = defaultSdkLoader
): StorageBackend {
  const evmRpc = opts?.evmRpc ?? DEFAULT_EVM_RPC;
  const indexerRpc = opts?.indexerRpc ?? DEFAULT_INDEXER_RPC;

  type SdkIndexer = InstanceType<SdkModule['Indexer']>;
  let ctxPromise: Promise<{ sdk: SdkModule; indexer: SdkIndexer }> | null = null;

  async function initCtx(): Promise<{ sdk: SdkModule; indexer: SdkIndexer }> {
    const sdk = await loadSdk();
    const indexer = new sdk.Indexer(indexerRpc);
    return { sdk, indexer };
  }

  function getCtx(): Promise<{ sdk: SdkModule; indexer: SdkIndexer }> {
    if (!ctxPromise) {
      // Memoize on success; on failure, clear so a later put()/get() retries init.
      ctxPromise = initCtx().catch((err) => {
        ctxPromise = null;
        throw err;
      });
    }
    return ctxPromise;
  }

  return {
    async put(blob: string): Promise<string> {
      if (!signer) {
        throw new Error('0G storage: put() needs a signer (the upload is an on-chain tx); this backend is download-only');
      }
      const { sdk, indexer } = await getCtx();

      const bytes = new TextEncoder().encode(blob);
      const file = new sdk.MemData(bytes);

      const [tree, treeErr] = await file.merkleTree();
      if (treeErr) throw new Error(`0G storage: merkleTree() failed: ${treeErr.message}`);
      if (!tree) throw new Error('0G storage: merkleTree() returned no tree');
      const rootHash = tree.rootHash();
      if (!rootHash) throw new Error('0G storage: merkleTree() produced no root hash');

      const [, upErr] = await indexer.upload(file, evmRpc, signer);
      if (upErr) throw new Error(`0G storage: upload() failed: ${upErr.message}`);

      return rootHash;
    },

    async get(uri: string): Promise<string> {
      const { indexer } = await getCtx();

      const [blob, err] = await indexer.downloadToBlob(uri);
      if (err) throw new Error(`0G storage: downloadToBlob() failed: ${err.message}`);
      if (!blob) throw new Error('0G storage: downloadToBlob() returned no blob');
      return blob.text();
    }
  };
}
