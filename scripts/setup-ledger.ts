// One-time helper to create (or top up) the 0G Compute master ledger for a
// wallet, so inference calls stop failing with "Account does not exist.
// Please create an account first." (see scripts/try-inference.ts). This is
// NOT a unit test and is not run by `npm test`. It is meant to be run
// manually by a human with a funded 0G Galileo testnet wallet.
//
// This script SPENDS testnet OG. It only acts when run explicitly with both
// PRIVATE_KEY and AMOUNT set — there is no default/dry-run path that touches
// the network.
//
// Usage:
//   PRIVATE_KEY=0x... AMOUNT=4 npx tsx scripts/setup-ledger.ts
//
// Env vars:
//   PRIVATE_KEY  (required) testnet wallet private key (0x...). The wallet
//                needs OG on 0G Galileo testnet (chainId 16602) to create/
//                fund the ledger. NEVER commit a real key; export it in your
//                shell before running this script.
//   ZEROG_RPC    (optional) JSON-RPC endpoint, default
//                https://evmrpc-testnet.0g.ai
//   AMOUNT       (required) OG amount to create the ledger with (or top up
//                an existing one), e.g. `4`. Per 0G project notes, creating
//                the ledger itself costs ~3 OG minimum
//                (LedgerProcessor.MIN_LEDGER_BALANCE_OG in the installed
//                SDK), plus ~1 OG per provider sub-account funded later.
//
// Unit assumption: AMOUNT is passed straight through to the SDK's
// `addLedger`/`depositFund` as a plain Number, which both document as being
// in OG units (matching the 0g-compute-cli's `--amount 10` convention) —
// NOT neuron/wei. Verify the on-chain ledger balance printed at the end of
// this script matches what you expect before trusting that assumption.
//
// Examples:
//   PRIVATE_KEY=0x... AMOUNT=4 npx tsx scripts/setup-ledger.ts
//   PRIVATE_KEY=0x... AMOUNT=4 ZEROG_RPC=https://... npx tsx scripts/setup-ledger.ts

import { ethers } from 'ethers';
import { createRequire } from 'node:module';

// tsx v4's esbuild loader mishandles the @0gfoundation/0g-compute-ts-sdk
// ESM chunk (fails with "does not provide an export named 'C'"), even
// though plain Node loads it fine via both import() and require(). Use
// createRequire to load the SDK's working CJS-resolved build, matching the
// same pattern used by scripts/try-inference.ts.
const requireSdk = createRequire(import.meta.url);
const loadSdk = async () => requireSdk('@0gfoundation/0g-compute-ts-sdk');

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ZEROG_RPC = process.env.ZEROG_RPC ?? 'https://evmrpc-testnet.0g.ai';
const AMOUNT_RAW = process.env.AMOUNT;

if (!PRIVATE_KEY) {
  console.error('PRIVATE_KEY required. Set it to a funded 0G Galileo testnet wallet key and re-run:');
  console.error('  PRIVATE_KEY=0x... AMOUNT=4 npx tsx scripts/setup-ledger.ts');
  process.exit(1);
}

const AMOUNT = AMOUNT_RAW === undefined ? NaN : Number(AMOUNT_RAW);
if (!Number.isFinite(AMOUNT) || AMOUNT <= 0) {
  console.error('AMOUNT required: a positive number of OG to create/top up the ledger with. Re-run e.g.:');
  console.error('  PRIVATE_KEY=0x... AMOUNT=4 npx tsx scripts/setup-ledger.ts');
  process.exit(1);
}

// Ledger structs (and other SDK return values) contain BigInt fields, which
// JSON.stringify can't serialize by default.
function stringifyLedger(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

async function main(): Promise<void> {
  console.log(`[1/3] connecting to ${ZEROG_RPC} (chainId 16602 expected)...`);
  const provider = new ethers.JsonRpcProvider(ZEROG_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY as string, provider);
  console.log(`      wallet address: ${wallet.address}`);

  console.log('[2/3] loading 0G Compute SDK and broker...');
  const { createZGComputeNetworkBroker } = await loadSdk();
  const broker = await createZGComputeNetworkBroker(wallet);

  console.log('[3/3] checking for an existing ledger...');
  let existingLedger: unknown;
  let hasLedger = true;
  try {
    existingLedger = await broker.ledger.getLedger();
  } catch {
    hasLedger = false;
  }

  if (hasLedger) {
    console.log('\nLedger already exists for this wallet:\n');
    console.log(stringifyLedger(existingLedger));
    console.log('\nNothing to do — not calling addLedger() again (it would fail/duplicate).');
    console.log('If you want to add more funds to this existing ledger, use depositFund() instead, e.g.:');
    console.log('  await broker.ledger.depositFund(<amountInOG>)');
    return;
  }

  console.log(`No ledger found. Creating ledger with ${AMOUNT} OG...`);
  await broker.ledger.addLedger(AMOUNT);

  const newLedger = await broker.ledger.getLedger();
  console.log('\nLedger created successfully:\n');
  console.log(stringifyLedger(newLedger));
  console.log('\nVerify the balance above matches the AMOUNT you funded it with before running inference.');
}

main().catch((err) => {
  console.error('\nFAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
