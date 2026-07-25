export const SIGN_MESSAGE = 'ENSight profile encryption key v1';
const enc = new TextEncoder(); const dec = new TextDecoder();
const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function deriveKey(signatureHex: string): Promise<CryptoKey> {
  const raw = unb64(btoa(signatureHex)); // bytes deterministici dalla firma
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('ensight'), info: enc.encode('profile') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
}
export async function encryptJson(key: CryptoKey, obj: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return b64(iv.buffer) + '.' + b64(ct);
}
export async function decryptJson<T>(key: CryptoKey, blob: string): Promise<T> {
  const [ivB, ctB] = blob.split('.');
  const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv: unb64(ivB) }, key, unb64(ctB));
  return JSON.parse(dec.decode(pt)) as T;
}
