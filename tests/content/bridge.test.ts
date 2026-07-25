// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { callInjected } from '../../src/content/bridge';

/**
 * Stands in for injected.ts: announces itself with dir:'ready' (bridge.ts holds
 * every request until it sees this, because postMessage is not queued for a
 * listener that does not exist yet), then answers requests.
 *
 * NOTE: bridge.ts resolves its readiness promise once, at module scope, so the
 * announcement only has to happen in the first test that needs it — but posting
 * it per-test is harmless and keeps each test readable on its own.
 */
function fakeMainWorld(answer: (req: any) => object) {
  // Non { once: true }: il primo messaggio che arriva è l'annuncio 'ready' qui
  // sotto, che consumerebbe il listener lasciando la richiesta senza risposta.
  const onMsg = (e: any) => {
    const m = e.data;
    if (m?.source !== 'ensight' || m.dir !== 'req') return;
    window.removeEventListener('message', onMsg);
    window.postMessage({ source: 'ensight', dir: 'res', id: m.id, ...answer(m) }, '*');
  };
  window.addEventListener('message', onMsg);
  window.postMessage({ source: 'ensight', dir: 'ready' }, '*');
}

describe('callInjected', () => {
  it('risolve quando arriva la risposta con lo stesso id', async () => {
    fakeMainWorld(() => ({ result: ['0xabc'] }));
    await expect(callInjected('eth_requestAccounts', [])).resolves.toEqual(['0xabc']);
  });

  it('rigetta se la risposta contiene error', async () => {
    fakeMainWorld(() => ({ error: 'rifiutato' }));
    await expect(callInjected('personal_sign', ['x'])).rejects.toThrow('rifiutato');
  });

  it('rigetta entro il timeout se nessuno risponde, invece di restare appesa per sempre', async () => {
    // Il MAIN world è pronto ma non risponde alla richiesta: senza timeout la
    // promise non si risolverebbe mai e withFallback non vedrebbe alcun errore,
    // così la pagina resterebbe non adattata in silenzio.
    // L'handshake va completato con i timer reali, prima di passare a quelli
    // finti, per non dipendere dall'ordine di esecuzione dei test.
    window.postMessage({ source: 'ensight', dir: 'ready' }, '*');
    await new Promise(r => setTimeout(r, 0));

    vi.useFakeTimers();
    try {
      const pending = callInjected('personal_sign', ['x'], 1_000);
      const assertion = expect(pending).rejects.toThrow(/nessuna risposta dal MAIN world/);
      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
