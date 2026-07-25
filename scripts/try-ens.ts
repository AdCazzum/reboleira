// Live smoke test for the real ENS service (Task 13, live part).
// This hits the actual Sepolia testnet ENS registry/resolver — it is NOT a
// unit test and is not run by `npm test`. It is meant to be run manually by
// a human who owns/manages a Sepolia ENS name, to sanity-check
// readProfilePointer()/the on-chain setText write path against the real ENS
// resolver before wiring it into the extension.
//
// This script does NOT call writeProfilePointer() from src/services/ens.ts.
// writeProfilePointer() writes via callInjected(), which posts a message to
// `window` and waits for the injected.ts content script (running inside a
// browser tab with MetaMask) to reply — there is no `window` under Node/tsx,
// so calling it here would throw immediately. Instead, the write half below
// replicates the on-chain setText call that src/content/injected.ts performs
// in the browser (BrowserProvider + signer.sendTransaction), but built on
// ethers.JsonRpcProvider + ethers.Wallet so it can run headlessly from a
// private key. The read half, in contrast, is pure (JsonRpcProvider only) so
// it imports and calls the real readProfilePointer() unmodified.
//
// WARNING: writing text records SPENDS Sepolia ETH (gas for two setText
// transactions). NEVER commit a real private key; export it in your shell
// before running this script.
//
// Usage:
//   npx tsx scripts/try-ens.ts
//
// Env vars:
//   PRIVATE_KEY   (required) Sepolia wallet private key (0x...) that OWNS/
//                 manages ENS_NAME (i.e. is authorized to call setText on its
//                 resolver). Needs Sepolia ETH to pay for gas.
//   SEPOLIA_RPC   (required, no default) Sepolia JSON-RPC endpoint. ENS
//                 lives on Sepolia for this project, so there is no sensible
//                 default — set this explicitly (e.g. an Infura/Alchemy
//                 Sepolia endpoint).
//   ENS_NAME      (required, no default) the Sepolia ENS name to read/write
//                 text records on (e.g. "yourname.eth"). The app normally
//                 reads this from CONFIG.ensName/VITE_ENS_NAME, but this
//                 standalone script takes it from ENS_NAME so it needs no
//                 .env file.
//
// Example:
//   PRIVATE_KEY=0x... SEPOLIA_RPC=https://sepolia.infura.io/v3/... \
//     ENS_NAME=yourname.eth npx tsx scripts/try-ens.ts

import { ethers } from 'ethers';
import { readProfilePointer } from '../src/services/ens';
import { CONFIG } from '../src/config';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const SEPOLIA_RPC = process.env.SEPOLIA_RPC;
const ENS_NAME = process.env.ENS_NAME;

// Guard first, before touching the network or constructing any provider/
// wallet objects — a missing var should fail fast and network-free.
if (!PRIVATE_KEY) {
  console.error('PRIVATE_KEY required. Set it to a funded Sepolia wallet key that owns ENS_NAME and re-run:');
  console.error('  PRIVATE_KEY=0x... SEPOLIA_RPC=... ENS_NAME=yourname.eth npx tsx scripts/try-ens.ts');
  process.exit(1);
}
if (!SEPOLIA_RPC) {
  console.error('SEPOLIA_RPC required (no default — ENS lives on Sepolia for this project). Set it and re-run:');
  console.error('  PRIVATE_KEY=0x... SEPOLIA_RPC=https://sepolia.infura.io/v3/... ENS_NAME=yourname.eth npx tsx scripts/try-ens.ts');
  process.exit(1);
}
if (!ENS_NAME) {
  console.error('ENS_NAME required (no default) — the Sepolia ENS name to read/write text records on. Set it and re-run:');
  console.error('  PRIVATE_KEY=0x... SEPOLIA_RPC=... ENS_NAME=yourname.eth npx tsx scripts/try-ens.ts');
  process.exit(1);
}

async function setText(
  wallet: ethers.Wallet,
  resolverAddress: string,
  node: string,
  key: string,
  value: string
): Promise<string> {
  const iface = new ethers.Interface(['function setText(bytes32 node,string key,string value)']);
  const tx = await wallet.sendTransaction({
    to: resolverAddress,
    data: iface.encodeFunctionData('setText', [node, key, value])
  });
  const receipt = await tx.wait();
  return receipt!.hash;
}

async function main(): Promise<void> {
  console.log(`[1/4] connecting to ${SEPOLIA_RPC}...`);
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY as string, provider);
  console.log(`      wallet address: ${wallet.address}`);
  console.log(`      ENS name:       ${ENS_NAME}`);

  console.log(`[2/4] resolving resolver for ${ENS_NAME}...`);
  const resolver = await provider.getResolver(ENS_NAME as string);
  if (!resolver) {
    console.error(`FAILED: no resolver found for ${ENS_NAME}. Does this name exist on Sepolia and have a resolver set?`);
    process.exitCode = 1;
    return;
  }
  const node = ethers.namehash(ENS_NAME as string);
  console.log(`      resolver: ${resolver.address}`);
  console.log(`      node:     ${node}`);

  const testProfileUri = `mem://ensight-test-${Date.now()}`;
  const testHuman = `test-nullifier-${Date.now()}`;

  console.log('[3/4] writing text records (this SPENDS Sepolia ETH)...');
  console.log(`      writing ${CONFIG.recordKeys.human} = ${testHuman}`);
  const humanTxHash = await setText(wallet, resolver.address, node, CONFIG.recordKeys.human, testHuman);
  console.log(`      txHash: ${humanTxHash}`);

  console.log(`      writing ${CONFIG.recordKeys.profile} = ${testProfileUri}`);
  const profileTxHash = await setText(wallet, resolver.address, node, CONFIG.recordKeys.profile, testProfileUri);
  console.log(`      txHash: ${profileTxHash}`);

  console.log('[4/4] re-reading text records via readProfilePointer()...');
  const result = await readProfilePointer(ENS_NAME as string, provider);
  console.log(`      profileUri: ${result.profileUri}`);
  console.log(`      human:      ${result.human}`);

  const profileOk = result.profileUri === testProfileUri;
  const humanOk = result.human === testHuman;
  console.log(profileOk && humanOk ? '\nPASS — both records round-tripped exactly' : '\nFAIL — round-trip does NOT match what was written');
  if (!profileOk) console.log(`  expected profileUri ${testProfileUri}, got ${result.profileUri}`);
  if (!humanOk) console.log(`  expected human ${testHuman}, got ${result.human}`);
  if (!profileOk || !humanOk) process.exitCode = 1;

  console.log(`\nAlso check the records manually at: https://sepolia.app.ens.domains/${ENS_NAME}`);
}

main().catch((err) => {
  console.error('Unexpected error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
