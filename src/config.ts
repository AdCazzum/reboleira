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
  ensName: env.VITE_ENS_NAME as string,
  worldAppId: env.VITE_WORLD_APP_ID as string,
  worldAction: env.VITE_WORLD_ACTION as string,
  // World ID 4.0 Relying Party id (rp_...), needed only by the standalone
  // demo/onboarding.tsx wizard to build a signed rp_context client-side for
  // IDKitRequestWidget (see .env.example for why this is demo-only and not
  // used anywhere in the packed extension). Not read by src/services/
  // world-id.ts or any content-script code path.
  worldRpId: env.VITE_WORLD_RP_ID as string,
  recordKeys: { profile: 'app.ensight.profile', human: 'app.ensight.human' }
} as const;
