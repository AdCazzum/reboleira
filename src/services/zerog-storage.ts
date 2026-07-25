import type { Wallet, JsonRpcSigner } from 'ethers';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

export interface ZeroGStorageOptions {
  evmRpc?: string;
  indexerRpc?: string;
}

const DEFAULT_EVM_RPC = 'https://evmrpc-testnet.0g.ai';
const DEFAULT_INDEXER_RPC = 'https://indexer-storage-testnet-turbo.0g.ai';

/**
 * Builds a `StorageBackend` backed by the real 0G Storage network.
 *
 * This is a NODE-only backend: `get()` downloads via the SDK's file-based
 * `Indexer.download()` (there is no in-memory download variant), writing to
 * a unique temp file that is read back and removed. `put()`/`get()` never
 * touch the SDK at module load time — it is loaded lazily via `loadSdk` on
 * first use (and memoized after that), so requiring this module — and
 * running the existing unit tests, which only ever exercise
 * storeProfile/loadProfile against a mock `StorageBackend` — never pulls the
 * SDK (or its network machinery) into the process. `loadSdk` defaults to
 * dynamic `import()`.
 */
export function createZeroGStorageBackend(
  signer: ZeroGSigner,
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

      const tmp = path.join(os.tmpdir(), `ensight-${uri.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}.bin`);
      try {
        const err = await indexer.download(uri, tmp, false);
        if (err) throw new Error(`0G storage: download() failed: ${err.message}`);
        return await fs.readFile(tmp, 'utf8');
      } finally {
        await fs.rm(tmp, { force: true });
      }
    }
  };
}
