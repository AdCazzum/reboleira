// Default timeout for a MAIN-world round trip. Generous on purpose: personal_sign
// and ens_setText wait for a human to approve in the wallet, and zerog_chat waits
// on a network switch plus model inference. The point is not to be strict — it is
// that a request which will NEVER be answered must not hang forever.
//
// Without this, an unanswered request leaves the promise pending indefinitely:
// if injected.js fails to load (blocked resource, CSP, extension reloaded after
// the page), the content script's adaptPage() never settles, so withFallback
// never sees an error and the fixture fallback never fires — the page just
// silently stays un-adapted.
const DEFAULT_TIMEOUT_MS = 60_000;

// How long to wait for injected.js to announce itself before giving up on the
// MAIN world entirely. Much shorter than DEFAULT_TIMEOUT_MS: nothing here waits
// on a human, so a silent MAIN world means it is broken, and failing fast lets
// the caller's fixture/static fallback kick in while the demo still looks live.
const READY_TIMEOUT_MS = 10_000;

/**
 * Resolves true once injected.ts has evaluated in the MAIN world.
 *
 * Necessary because window.postMessage is NOT queued for listeners that do not
 * exist yet: injected.js is a module script, so it loads and evaluates
 * asynchronously (and pulls in ethers + the 0G chunks on the way). A request
 * posted before it has run is dropped on the floor and nothing ever answers —
 * which showed up as a flaky, un-adapted page when the toggle arrived early.
 *
 * The listener is registered at module scope, i.e. before content-script.ts
 * appends the script tag, so the announcement cannot be missed.
 */
const injectedReady: Promise<boolean> = new Promise(resolve => {
  const onReady = (e: MessageEvent) => {
    if (e.data?.source !== 'ensight' || e.data.dir !== 'ready') return;
    window.removeEventListener('message', onReady);
    resolve(true);
  };
  window.addEventListener('message', onReady);
  setTimeout(() => {
    window.removeEventListener('message', onReady);
    resolve(false);
  }, READY_TIMEOUT_MS);
});

let seq = 0;
export function callInjected<T = unknown>(method: string, params: unknown[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const id = `ens-${seq++}`;
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      window.removeEventListener('message', onMsg);
      clearTimeout(timer);
    };
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m?.source !== 'ensight' || m.dir !== 'res' || m.id !== id) return;
      cleanup();
      m.error ? reject(new Error(m.error)) : resolve(m.result as T);
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`ensight: nessuna risposta dal MAIN world per "${method}" entro ${timeoutMs}ms (wallet in attesa di approvazione?)`));
    }, timeoutMs);
    window.addEventListener('message', onMsg);
    injectedReady.then(ready => {
      if (!ready) {
        cleanup();
        reject(new Error(`ensight: il MAIN world non ha risposto entro ${READY_TIMEOUT_MS}ms — injected.js non caricato, "${method}" non inviato`));
        return;
      }
      window.postMessage({ source: 'ensight', dir: 'req', id, method, params }, '*');
    });
  });
}
