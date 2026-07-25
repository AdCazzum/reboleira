// Manual browser harness (Task 12) for exercising the REAL wallet bridge:
// src/content/bridge.ts (callInjected) talking to src/content/injected.ts
// (the window-message handler that drives window.ethereum via ethers).
//
// In the shipped extension, bridge.ts runs in the content script's ISOLATED
// world and injected.ts runs in the page's MAIN world, bridged by
// window.postMessage. In this plain page BOTH run in the same window, but
// window.postMessage still connects them exactly the same way, and MetaMask
// injects window.ethereum into this page just like it would into any real
// site. That makes this a faithful manual test of the callInjected protocol
// and its eth_requestAccounts / personal_sign handlers end-to-end, without
// needing the extension loaded.
//
// NOT part of the shipped extension - dev/test artifact only. Does not test
// ens_setText (needs a Sepolia ENS name + CONFIG.ensName from env - that is
// Task 13's concern).

import { callInjected } from '../src/content/bridge';
import '../src/content/injected'; // side effect only: registers the window message handler
import { SIGN_MESSAGE, deriveKey } from '../src/core/crypto';

const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const signBtn = document.getElementById('sign') as HTMLButtonElement;
const resultsEl = document.getElementById('results') as HTMLElement;

function log(line: string): void {
  resultsEl.textContent += `${line}\n`;
}

function logError(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  log(`ERROR (${context}): ${message}`);
}

connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  try {
    log('> callInjected("eth_requestAccounts", [])');
    const accounts = await callInjected<string[]>('eth_requestAccounts', []);
    const account = accounts[0];
    log(`Connected account: ${account}`);
    signBtn.disabled = false;
  } catch (err) {
    logError('eth_requestAccounts', err);
  } finally {
    connectBtn.disabled = false;
  }
});

signBtn.addEventListener('click', async () => {
  signBtn.disabled = true;
  try {
    log(`> callInjected("personal_sign", [${JSON.stringify(SIGN_MESSAGE)}])`);
    const sig = await callInjected<string>('personal_sign', [SIGN_MESSAGE]);
    log(`Signature: ${sig}`);
    log('> deriveKey(signature)');
    const key = await deriveKey(sig);
    log(
      `key derived OK (non-extractable CryptoKey): extractable=${key.extractable}, type=${key.type}, algorithm=${JSON.stringify(key.algorithm)}`
    );
  } catch (err) {
    logError('personal_sign / deriveKey', err);
  } finally {
    signBtn.disabled = false;
  }
});

log('Ready. Click "Connect wallet" to begin (requires MetaMask, served over http://localhost).');
