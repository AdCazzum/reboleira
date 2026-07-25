export const CONFIG = {
  sepoliaRpc: import.meta.env.VITE_SEPOLIA_RPC as string,
  zerogRpc: import.meta.env.VITE_ZEROG_RPC as string,
  zerogChainId: 16602, // 0G Galileo testnet — live-verified via evmrpc-testnet.0g.ai (the plan's 16601 is outdated)
  ensName: import.meta.env.VITE_ENS_NAME as string,
  worldAppId: import.meta.env.VITE_WORLD_APP_ID as string,
  worldAction: import.meta.env.VITE_WORLD_ACTION as string,
  recordKeys: { profile: 'app.ensight.profile', human: 'app.ensight.human' }
} as const;
