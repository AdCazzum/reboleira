import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/content/bridge', () => ({ callInjected: vi.fn(async () => '0xTX') }));
import { readProfilePointer, writeProfilePointer } from '../../src/services/ens';
import { callInjected } from '../../src/content/bridge';

const provider = { getResolver: async () => ({ getText: async (k:string) =>
  k === 'app.ensight.profile' ? 'mem://1' : k === 'app.ensight.human' ? 'nullifier-x' : null }) } as any;

describe('ENS service', () => {
  it('legge i due record dal resolver', async () => {
    expect(await readProfilePointer('n.eth', provider)).toEqual({ profileUri:'mem://1', human:'nullifier-x' });
  });
  it('scrive il record profilo via bridge e ritorna il txHash', async () => {
    const tx = await writeProfilePointer('n.eth', 'mem://2', 'nullifier-y');
    expect(tx).toBe('0xTX');
    expect(callInjected).toHaveBeenCalledWith('ens_setText', ['app.ensight.profile','mem://2']);
  });
});
