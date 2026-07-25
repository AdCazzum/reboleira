import { describe, it, expect } from 'vitest';
import { deriveKey, encryptJson, decryptJson } from '../../src/core/crypto';

const sig = '0x' + 'ab'.repeat(65); // firma fittizia deterministica

describe('crypto', () => {
  it('round-trip encrypt/decrypt ritorna l\'oggetto originale', async () => {
    const key = await deriveKey(sig);
    const blob = await encryptJson(key, { hello: 'mondo', n: 42 });
    expect(await decryptJson(key, blob)).toEqual({ hello: 'mondo', n: 42 });
  });
  it('chiave da firma diversa non decifra', async () => {
    const k1 = await deriveKey(sig);
    const k2 = await deriveKey('0x' + 'cd'.repeat(65));
    const blob = await encryptJson(k1, { x: 1 });
    await expect(decryptJson(k2, blob)).rejects.toBeDefined();
  });
});
