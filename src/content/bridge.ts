let seq = 0;
export function callInjected<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const id = `ens-${seq++}`;
  return new Promise<T>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m?.source !== 'ensight' || m.dir !== 'res' || m.id !== id) return;
      window.removeEventListener('message', onMsg);
      m.error ? reject(new Error(m.error)) : resolve(m.result as T);
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ source: 'ensight', dir: 'req', id, method, params }, '*');
  });
}
