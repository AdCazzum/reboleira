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
//
// KNOWN LIMITATION (pre-existing, outside this task's file set): src/config.ts
// reads `import.meta.env.VITE_*` unconditionally at module load time. Vite
// (and vitest, which is Vite-powered) provides `import.meta.env`, but plain
// Node/tsx does not — importing CONFIG (directly, or transitively via
// src/services/ens.ts, which readProfilePointer() lives in) will throw
// `Cannot read properties of undefined (reading 'VITE_SEPOLIA_RPC')` under
// tsx. This is not caused by anything in this script or by the read/write
// design above; it reproduces with `npx tsx -e "import('../src/config.ts')"`
// alone. It is not fixable from here without either modifying src/config.ts
// (out of scope for Task 13 — that file belongs to earlier tasks and other
// components depend on its current shape) or adding custom Node loader
// infrastructure (disproportionate for a manual smoke script). The env-var
// guards below still run first and fail fast on their own; the import of
// readProfilePointer/CONFIG is deferred (dynamic import, inside main(), after
// the guards) so at least a missing env var is reported before this hits. A
// minimal future fix, for whoever owns src/config.ts, would be:
//   const env = (import.meta as any).env ?? process.env;
//   export const CONFIG = { sepoliaRpc: env.VITE_SEPOLIA_RPC as string, ... };

import { ethers } from 'ethers';

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
  console.log(`[1/5] connecting to ${SEPOLIA_RPC}...`);
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY as string, provider);
  console.log(`      wallet address: ${wallet.address}`);
  console.log(`      ENS name:       ${ENS_NAME}`);

  // Deferred (dynamic) import: readProfilePointer lives in
  // src/services/ens.ts, which statically imports CONFIG from
  // src/config.ts. See the KNOWN LIMITATION note in the header comment —
  // that import can throw under plain tsx for reasons unrelated to this
  // script. Deferring it to here (after the env-var guards above already
  // ran) means a missing env var is still always reported first; if this
  // step itself fails, print a clear diagnostic instead of a raw stack trace.
  console.log('[2/5] loading readProfilePointer()/CONFIG (src/services/ens.ts, src/config.ts)...');
  let readProfilePointer: typeof import('../src/services/ens').readProfilePointer;
  let CONFIG: typeof import('../src/config').CONFIG;
  try {
    ({ readProfilePointer } = await import('../src/services/ens'));
    ({ CONFIG } = await import('../src/config'));
  } catch (err) {
    console.error('\nFAILED to load src/services/ens.ts / src/config.ts:', err instanceof Error ? err.message : err);
    console.error('This is the KNOWN LIMITATION described in this script\'s header comment: src/config.ts reads');
    console.error('import.meta.env.* unconditionally, which plain Node/tsx does not provide (only Vite/vitest do).');
    console.error('See the header comment above for a minimal suggested fix to src/config.ts (out of scope here).');
    process.exitCode = 1;
    return;
  }

  console.log(`[3/5] resolving resolver for ${ENS_NAME}...`);
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

  console.log('[4/5] writing text records (this SPENDS Sepolia ETH)...');
  console.log(`      writing ${CONFIG.recordKeys.human} = ${testHuman}`);
  const humanTxHash = await setText(wallet, resolver.address, node, CONFIG.recordKeys.human, testHuman);
  console.log(`      txHash: ${humanTxHash}`);

  console.log(`      writing ${CONFIG.recordKeys.profile} = ${testProfileUri}`);
  const profileTxHash = await setText(wallet, resolver.address, node, CONFIG.recordKeys.profile, testProfileUri);
  console.log(`      txHash: ${profileTxHash}`);

  console.log('[5/5] re-reading text records via readProfilePointer()...');
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
