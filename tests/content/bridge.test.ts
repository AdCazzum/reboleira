// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { callInjected } from '../../src/content/bridge';
describe('callInjected', () => {
  it('risolve quando arriva la risposta con lo stesso id', async () => {
    window.addEventListener('message', (e:any) => {
      const m = e.data; if (m?.source==='ensight' && m.dir==='req')
        window.postMessage({ source:'ensight', dir:'res', id:m.id, result:['0xabc'] }, '*');
    }, { once: true });
    await expect(callInjected('eth_requestAccounts', [])).resolves.toEqual(['0xabc']);
  });
  it('rigetta se la risposta contiene error', async () => {
    window.addEventListener('message', (e:any) => {
      const m = e.data; if (m?.source==='ensight' && m.dir==='req')
        window.postMessage({ source:'ensight', dir:'res', id:m.id, error:'rifiutato' }, '*');
    }, { once: true });
    await expect(callInjected('personal_sign', ['x'])).rejects.toThrow('rifiutato');
  });
});
