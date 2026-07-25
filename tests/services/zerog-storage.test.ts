import { describe, it, expect } from 'vitest';
import { storeProfile, loadProfile } from '../../src/services/zerog-storage';
import { deriveKey } from '../../src/core/crypto';
const profile = { version:1, language:'it', readingLevel:'simple', accessibility:{dyslexiaFriendly:true,highContrast:false,largeText:true,reduceClutter:true}, expertiseDomains:[], tone:'plain' } as any;

function memBackend() { const m = new Map<string,string>(); let i=0;
  return { async put(b:string){ const u=`mem://${i++}`; m.set(u,b); return u; }, async get(u:string){ return m.get(u)!; } }; }

describe('0G storage round-trip cifrato', () => {
  it('store poi load ritorna lo stesso profilo', async () => {
    const key = await deriveKey('0x'+'ab'.repeat(65));
    const be = memBackend();
    const uri = await storeProfile(profile, key, be);
    expect(await loadProfile(uri, key, be)).toEqual(profile);
  });
  it('il payload in storage è cifrato (non contiene testo in chiaro)', async () => {
    const key = await deriveKey('0x'+'ab'.repeat(65));
    const be = memBackend(); const uri = await storeProfile(profile, key, be);
    expect(await be.get(uri)).not.toContain('dyslexiaFriendly');
  });
});
