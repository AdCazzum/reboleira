// Env comes from Vite's `import.meta.env` when bundled by Vite/vitest. Under
// plain Node/tsx (e.g. scripts/try-ens.ts) import.meta.env is undefined, so
// fall back to {} — only the env-derived fields are then undefined; the
// static recordKeys/chainId are always present, which is all a headless
// script needs.
const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;

export const CONFIG = {
  sepoliaRpc: env.VITE_SEPOLIA_RPC as string,
  zerogRpc: env.VITE_ZEROG_RPC as string,
  zerogChainId: 16602, // 0G Galileo testnet — live-verified via evmrpc-testnet.0g.ai (the plan's 16601 is outdated)
  // 0G Storage indexer. Optional: createZeroGStorageBackend falls back to its
  // own DEFAULT_INDEXER_RPC when this is undefined.
  zerogIndexer: env.VITE_ZEROG_INDEXER as string | undefined,
  // 0G Compute inference provider address. Optional and load-bearing: when it
  // is unset the content script skips the live-inference attempt entirely and
  // renders the pre-computed fixture, instead of making a call that is certain
  // to fail. Discover an address with `npx tsx scripts/try-inference.ts`.
  zerogInferenceProvider: env.VITE_ZEROG_INFERENCE_PROVIDER as string | undefined,
  ensName: env.VITE_ENS_NAME as string,
  // The onboarding wizard is NOT an extension page: it needs a Node process to
  // sign World ID's rp_context (see scripts/onboarding-server.mjs), so it is
  // served over http and the popup links out to it.
  onboardingUrl: env.VITE_ONBOARDING_URL ?? 'http://localhost:8080/onboarding.html',
  worldAppId: env.VITE_WORLD_APP_ID as string,
  worldAction: env.VITE_WORLD_ACTION as string,
  // World ID 4.0's rp_id is NOT read here: it is only needed to assemble
  // rp_context, which is now assembled entirely server-side by
  // scripts/onboarding-server.mjs (WORLD_RP_ID env var, deliberately not
  // VITE_-prefixed) and returned whole to demo/onboarding.tsx over
  // POST /rp-context. Nothing in the browser bundle needs it.
  recordKeys: { profile: 'app.ensight.profile', human: 'app.ensight.human' }
} as const;
