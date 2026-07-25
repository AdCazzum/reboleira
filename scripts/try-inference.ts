// Live smoke test for the real 0G Compute broker (Task 10, live part).
// This hits the actual 0G Galileo testnet — it is NOT a unit test and is not
// run by `npm test`. It is meant to be run manually by a human with a funded
// testnet wallet, to sanity-check createZeroGBroker()/requestUISpec() against
// the real inference API before wiring it into the extension.
//
// Usage:
//   npx tsx scripts/try-inference.ts
//
// Env vars:
//   PRIVATE_KEY       (required) testnet wallet private key (0x...). The
//                      wallet needs OG on 0G Galileo testnet (chainId 16601)
//                      to pay for gas and inference. NEVER commit a real key;
//                      export it in your shell before running this script.
//   ZEROG_RPC         (optional) JSON-RPC endpoint, default
//                      https://evmrpc-testnet.0g.ai
//   PROVIDER_ADDRESS  (optional) inference provider address to use. If unset,
//                      this script lists the available providers and exits so
//                      you can pick one and re-run with it set.
//
// Funding note: before the first real inference call, the account's ledger
// may need funding, e.g.:
//   await broker.ledger.depositFund(<amountInOG>)
// or via the CLI:
//   npx 0g-compute-cli deposit --amount <amountInOG>
// If a chat() call fails with an insufficient-balance-style error, fund the
// ledger (and/or the provider sub-account) and re-run.
//
// Examples:
//   PRIVATE_KEY=0x... npx tsx scripts/try-inference.ts
//   PRIVATE_KEY=0x... PROVIDER_ADDRESS=0xabc... npx tsx scripts/try-inference.ts

import { ethers } from 'ethers';
import { createZeroGBroker, requestUISpec } from '../src/services/zerog-compute';
import type { Broker } from '../src/services/zerog-compute';
import type { ContentGraph, PersonaProfile } from '../src/core/types';
import { createRequire } from 'node:module';

// tsx v4's esbuild loader mishandles the @0gfoundation/0g-compute-ts-sdk
// ESM chunk (fails with "does not provide an export named 'C'"), even
// though plain Node loads it fine via both import() and require(). Use
// createRequire to load the SDK's working CJS-resolved build when this
// script runs under tsx; createZeroGBroker still defaults to import() for
// the Vite-bundled browser extension.
const requireSdk = createRequire(import.meta.url);
const loadSdk = async () => requireSdk('@0gfoundation/0g-compute-ts-sdk');

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ZEROG_RPC = process.env.ZEROG_RPC ?? 'https://evmrpc-testnet.0g.ai';
const PROVIDER_ADDRESS = process.env.PROVIDER_ADDRESS;

if (!PRIVATE_KEY) {
  console.error('PRIVATE_KEY required. Set it to a funded 0G Galileo testnet wallet key and re-run:');
  console.error('  PRIVATE_KEY=0x... npx tsx scripts/try-inference.ts');
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`[1/4] connecting to ${ZEROG_RPC} (chainId 16601 expected)...`);
  const provider = new ethers.JsonRpcProvider(ZEROG_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY as string, provider);
  console.log(`      wallet address: ${wallet.address}`);

  if (!PROVIDER_ADDRESS) {
    console.log('[2/4] no PROVIDER_ADDRESS set — listing available inference providers...');
    const { createZGComputeNetworkBroker } = await loadSdk();
    const sdkBroker = await createZGComputeNetworkBroker(wallet);
    const services = await sdkBroker.inference.listService();

    if (services.length === 0) {
      console.log('No providers found on this network.');
      return;
    }
    console.log(`Found ${services.length} provider(s):\n`);
    for (const s of services) {
      console.log(`  provider: ${s.provider}`);
      console.log(`    model:        ${s.model}`);
      console.log(`    url:          ${s.url}`);
      console.log(`    inputPrice:   ${s.inputPrice}`);
      console.log(`    outputPrice:  ${s.outputPrice}`);
      console.log(`    acknowledged: ${s.teeSignerAcknowledged}`);
      console.log('');
    }
    console.log('Re-run with one of these, e.g.:');
    console.log(`  PRIVATE_KEY=... PROVIDER_ADDRESS=${services[0].provider} npx tsx scripts/try-inference.ts`);
    return;
  }

  console.log(`[2/4] using provider ${PROVIDER_ADDRESS}`);

  const graph: ContentGraph = {
    url: 'https://example.test/try-inference',
    title: 'Prova ENSight',
    blocks: [
      { id: 'block-0', type: 'heading', level: 1, text: 'Benvenuto su ENSight' },
      { id: 'block-1', type: 'action', text: 'Iscriviti alla newsletter' }
    ]
  };
  const profile: PersonaProfile = {
    version: 1,
    language: 'it',
    readingLevel: 'simple',
    accessibility: { dyslexiaFriendly: false, highContrast: false, largeText: false, reduceClutter: false },
    expertiseDomains: [],
    tone: 'neutral'
  };

  let lastRawReply: string | null = null;
  const zerogBroker = createZeroGBroker(wallet, PROVIDER_ADDRESS, loadSdk);
  const diagnosticBroker: Broker = {
    async chat(messages) {
      const raw = await zerogBroker.chat(messages);
      lastRawReply = raw;
      return raw;
    }
  };

  console.log('[3/4] calling live 0G inference (requestUISpec)...');
  try {
    const spec = await requestUISpec(graph, profile, diagnosticBroker);
    console.log('[4/4] validated UISpec:\n');
    console.log(JSON.stringify(spec, null, 2));
  } catch (err) {
    console.error('\nFAILED:', err instanceof Error ? err.message : err);
    if (lastRawReply) {
      console.error('\nRaw model reply (for debugging):\n');
      console.error(lastRawReply);
    } else {
      console.error('\n(no raw model reply was captured — the failure happened before/without a broker response)');
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
