import { describe, it, expect } from 'vitest';
import { attestationFromProof } from '../../src/services/world-id';
describe('attestationFromProof', () => {
  it('usa il nullifier_hash come attestation', () => {
    expect(attestationFromProof({ nullifier_hash: '0xdead' })).toBe('world:0xdead');
  });
  it('lancia se manca il nullifier', () => {
    expect(() => attestationFromProof({} as any)).toThrow();
  });
});
