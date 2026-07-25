import { ethers } from 'ethers';
import { CONFIG } from '../config';
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
    reply({ error: `metodo sconosciuto: ${m.method}` });
  } catch (err: any) { reply({ error: err?.message ?? String(err) }); }
});
