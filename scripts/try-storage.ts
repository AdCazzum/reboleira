// Live smoke test for the real 0G Storage backend (Task 11, live part).
// This hits the actual 0G Galileo testnet storage network — it is NOT a
// unit test and is not run by `npm test`. It is meant to be run manually by
// a human with a funded testnet wallet, to sanity-check
// createZeroGStorageBackend()/storeProfile()/loadProfile() against the real
// 0G Storage indexer/network before wiring it into the extension.
//
// WARNING: uploading SPENDS testnet OG (gas to submit the upload tx, plus a
// storage fee charged by the flow contract). NEVER commit a real private
// key; export it in your shell before running this script.
//
// Usage:
//   npx tsx scripts/try-storage.ts
//
// Env vars:
//   PRIVATE_KEY   (required) testnet wallet private key (0x...). The wallet
//                 needs OG on 0G Galileo testnet (chainId 16601) to pay for
//                 upload gas + storage fees.
//   ZEROG_RPC     (optional) EVM JSON-RPC endpoint, default
//                 https://evmrpc-testnet.0g.ai
//   INDEXER_RPC   (optional) 0G Storage indexer endpoint, default
//                 https://indexer-storage-testnet-turbo.0g.ai
//   DOWNLOAD_URI  (optional) if set, SKIPS the upload step entirely and only
//                 downloads + decrypts this root hash (as printed by a prior
//                 run's "uploaded -> rootHash (storage URI): ..." line). Use
//                 this to retry just the download half if loadProfile()
//                 failed right after storeProfile() succeeded — 0G Storage
//                 propagation/finality can take a few seconds, so an
//                 immediate download can legitimately fail even though the
//                 upload itself went through.
//
// Examples:
//   PRIVATE_KEY=0x... npx tsx scripts/try-storage.ts
//   PRIVATE_KEY=0x... DOWNLOAD_URI=0xabc... npx tsx scripts/try-storage.ts

import { ethers } from 'ethers';
import { createRequire } from 'node:module';
import { createZeroGStorageBackend, storeProfile, loadProfile } from '../src/services/zerog-storage';
import { SIGN_MESSAGE, deriveKey } from '../src/core/crypto';
import type { PersonaProfile } from '../src/core/types';

// tsx v4's esbuild loader mishandles the @0gfoundation 0G SDKs' ESM chunks
// (fails with "does not provide an export named ..."), even though plain
// Node loads them fine via both import() and require(). Use createRequire to
// load the SDK's working CJS-resolved build when this script runs under
// tsx; createZeroGStorageBackend still defaults to import() for the
// Vite-bundled browser extension. (Identical workaround to
// scripts/try-inference.ts / scripts/setup-ledger.ts for
// @0gfoundation/0g-compute-ts-sdk.)
const requireSdk = createRequire(import.meta.url);
const loadSdk = async () => requireSdk('@0gfoundation/0g-storage-ts-sdk');

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ZEROG_RPC = process.env.ZEROG_RPC ?? 'https://evmrpc-testnet.0g.ai';
const INDEXER_RPC = process.env.INDEXER_RPC ?? 'https://indexer-storage-testnet-turbo.0g.ai';
const DOWNLOAD_URI = process.env.DOWNLOAD_URI;

// Guard first, before touching the network or constructing any SDK/wallet
// objects — a missing key should fail fast and network-free.
if (!PRIVATE_KEY) {
  console.error('PRIVATE_KEY required. Set it to a funded 0G Galileo testnet wallet key and re-run:');
  console.error('  PRIVATE_KEY=0x... npx tsx scripts/try-storage.ts');
  process.exit(1);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main(): Promise<void> {
  console.log(`[1/5] connecting to ${ZEROG_RPC} (chainId 16601 expected)...`);
  const provider = new ethers.JsonRpcProvider(ZEROG_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY as string, provider);
  console.log(`      wallet address: ${wallet.address}`);
  console.log(`      indexer:        ${INDEXER_RPC}`);

  console.log('[2/5] deriving encryption key from wallet signature (same as the app)...');
  const sig = await wallet.signMessage(SIGN_MESSAGE);
  const key = await deriveKey(sig);

  const backend = createZeroGStorageBackend(wallet, { evmRpc: ZEROG_RPC, indexerRpc: INDEXER_RPC }, loadSdk);

  const profile: PersonaProfile = {
    version: 1,
    language: 'it',
    readingLevel: 'simple',
    accessibility: { dyslexiaFriendly: true, highContrast: false, largeText: true, reduceClutter: true },
    expertiseDomains: ['finance'],
    tone: 'plain'
  };

  if (DOWNLOAD_URI) {
    console.log(`[3/5] DOWNLOAD_URI set — skipping upload, downloading + decrypting ${DOWNLOAD_URI} directly...`);
    try {
      const back = await loadProfile(DOWNLOAD_URI, key, backend);
      console.log('\nPASS — downloaded and decrypted successfully:\n');
      console.log(JSON.stringify(back, null, 2));
    } catch (err) {
      console.error('\nFAILED to download/decrypt:', err instanceof Error ? err.message : err);
      console.error('If this is happening right after an upload, 0G Storage may still be propagating the file.');
      console.error(`Wait a few seconds and re-run: DOWNLOAD_URI=${DOWNLOAD_URI} npx tsx scripts/try-storage.ts`);
      process.exitCode = 1;
    }
    return;
  }

  console.log('[3/5] uploading encrypted profile (storeProfile)... this SPENDS testnet OG');
  let uri: string;
  try {
    uri = await storeProfile(profile, key, backend);
  } catch (err) {
    console.error('\nFAILED on upload:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }
  console.log(`      uploaded -> rootHash (storage URI): ${uri}`);

  console.log('[4/5] downloading + decrypting (loadProfile)...');
  let back: PersonaProfile;
  try {
    back = await loadProfile(uri, key, backend);
  } catch (err) {
    console.error('\nFAILED on download:', err instanceof Error ? err.message : err);
    console.error('0G Storage can take a few seconds to propagate a freshly uploaded file before it is');
    console.error('downloadable. The upload itself succeeded — retry just the download with:');
    console.error(`  DOWNLOAD_URI=${uri} npx tsx scripts/try-storage.ts`);
    process.exitCode = 1;
    return;
  }

  console.log('[5/5] comparing round-trip result to the original profile...\n');
  const pass = deepEqual(back, profile);
  console.log(pass ? 'PASS — round-trip matches exactly' : 'FAIL — round-trip does NOT match');
  console.log('\noriginal profile:');
  console.log(JSON.stringify(profile, null, 2));
  console.log('\ndecrypted profile:');
  console.log(JSON.stringify(back, null, 2));
  if (!pass) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unexpected error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
