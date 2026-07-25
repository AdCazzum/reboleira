import type { JsonRpcProvider } from 'ethers';
import { CONFIG } from '../config';
import { callInjected } from '../content/bridge';
export async function readProfilePointer(name: string, provider: JsonRpcProvider) {
  const r = await provider.getResolver(name);
  if (!r) return {};
  const [profileUri, human] = await Promise.all([
    r.getText(CONFIG.recordKeys.profile), r.getText(CONFIG.recordKeys.human)]);
  return { profileUri: profileUri ?? undefined, human: human ?? undefined };
}
export async function writeProfilePointer(_name: string, uri: string, human: string): Promise<string> {
  await callInjected('ens_setText', [CONFIG.recordKeys.human, human]);
  return callInjected<string>('ens_setText', [CONFIG.recordKeys.profile, uri]);
}
