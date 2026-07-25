import { ethers } from 'ethers';
import { CONFIG } from '../config';
import { createZeroGBroker, type Broker } from '../services/zerog-compute';

// CONFIG.zerogChainId (16602) as the 0x-hex chainId wallets expect.
const ZEROG_CHAIN_HEX = '0x40DA';

// Mirrors demo/onboarding.tsx's switchChain: wallet_addEthereumChain does not
// reliably leave the wallet ON the chain it just added (behaviour differs by
// wallet/version), so re-read the active chain and fail loudly rather than
// signing against the wrong network.
async function switchChain(eth: any, chainIdHex: string, addParams?: Record<string, unknown>): Promise<void> {
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
  } catch (err: any) {
    const code = err?.code ?? err?.data?.originalError?.code;
    if (code === 4902 && addParams) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [addParams] });
      const active = (await eth.request({ method: 'eth_chainId' })) as string;
      if (active.toLowerCase() !== chainIdHex.toLowerCase()) {
        throw new Error(`Wallet added chain ${chainIdHex} but is still on ${active} — switch to it manually and retry.`);
      }
    } else {
      throw err;
    }
  }
}

// Memoized across calls: createZeroGBroker's first chat() acknowledges the
// provider signer, which is an on-chain transaction. Rebuilding the broker per
// page adaptation would re-send it (and re-prompt the wallet) every time.
let brokerPromise: Promise<Broker> | null = null;
async function zerogBroker(eth: any): Promise<Broker> {
  if (!brokerPromise) {
    brokerPromise = (async () => {
      if (!CONFIG.zerogInferenceProvider) {
        throw new Error('VITE_ZEROG_INFERENCE_PROVIDER non configurato');
      }
      await switchChain(eth, ZEROG_CHAIN_HEX, {
        chainId: ZEROG_CHAIN_HEX,
        chainName: '0G Galileo Testnet',
        rpcUrls: [CONFIG.zerogRpc],
        nativeCurrency: { name: 'OG', symbol: 'OG', decimals: 18 }
      });
      const signer = await new ethers.BrowserProvider(eth).getSigner();
      return createZeroGBroker(signer, CONFIG.zerogInferenceProvider);
    })().catch((err) => {
      // Clear on failure so a later attempt can retry (e.g. after the user
      // funds the ledger or approves the network switch).
      brokerPromise = null;
      throw err;
    });
  }
  return brokerPromise;
}

window.addEventListener('message', async (e) => {
  const m = (e as MessageEvent).data;
  if (m?.source !== 'ensight' || m.dir !== 'req') return;
  const reply = (p: object) => window.postMessage({ source:'ensight', dir:'res', id:m.id, ...p }, '*');
  try {
    const eth = (window as any).ethereum;
    if (m.method === 'eth_requestAccounts') return reply({ result: await eth.request({ method:'eth_requestAccounts' }) });
    if (m.method === 'personal_sign') {
      const [account] = await eth.request({ method:'eth_requestAccounts' });
      return reply({ result: await eth.request({ method:'personal_sign', params:[m.params[0], account] }) });
    }
    if (m.method === 'ens_setText') {
      const provider = new ethers.BrowserProvider(eth);
      const signer = await provider.getSigner();
      const resolver = await provider.getResolver(CONFIG.ensName); // resolver del nome
      const iface = new ethers.Interface(['function setText(bytes32 node,string key,string value)']);
      const node = ethers.namehash(CONFIG.ensName);
      const [key, value] = m.params;
      const tx = await signer.sendTransaction({ to: resolver!.address, data: iface.encodeFunctionData('setText',[node,key,value]) });
      return reply({ result: (await tx.wait())!.hash });
    }
    // Live generative UI: the content script sends the already-built
    // { system, user } prompt and gets the model's raw reply back. It does the
    // JSON extraction and UISpec validation itself — nothing from this world
    // is trusted as a spec.
    if (m.method === 'zerog_chat') {
      const broker = await zerogBroker(eth);
      return reply({ result: await broker.chat(m.params[0]) });
    }
    reply({ error: `metodo sconosciuto: ${m.method}` });
  } catch (err: any) { reply({ error: err?.message ?? String(err) }); }
});

// Announce that this world is ready to answer. bridge.ts holds every request
// until it sees this: postMessage is not queued, so anything sent before the
// listener above existed would be lost silently (this file is a module script,
// so it evaluates well after the content script that injected it).
window.postMessage({ source: 'ensight', dir: 'ready' }, '*');
