export function attestationFromProof(proof: { nullifier_hash?: string }): string {
  if (!proof?.nullifier_hash) throw new Error('proof World senza nullifier_hash');
  return `world:${proof.nullifier_hash}`;
}
