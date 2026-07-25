import type { PersonaProfile } from '../core/types';
import { encryptJson, decryptJson } from '../core/crypto';
export interface StorageBackend { put(blob: string): Promise<string>; get(uri: string): Promise<string>; }
export async function storeProfile(p: PersonaProfile, key: CryptoKey, be: StorageBackend): Promise<string> {
  return be.put(await encryptJson(key, p));
}
export async function loadProfile(uri: string, key: CryptoKey, be: StorageBackend): Promise<PersonaProfile> {
  return decryptJson<PersonaProfile>(key, await be.get(uri));
}
