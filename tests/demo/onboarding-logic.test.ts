import { describe, it, expect } from 'vitest';
import {
  SEPOLIA_CHAIN_HEX, ZEROG_CHAIN_HEX, chainLabel, shortenMiddle,
  parseDomains, formatDomains, commitChips, guidanceFor, preflightIssues
} from '../../demo/onboarding-logic';

describe('chainLabel', () => {
  it('names the two chains the wizard switches between', () => {
    expect(chainLabel(SEPOLIA_CHAIN_HEX)).toBe('Sepolia');
    expect(chainLabel(ZEROG_CHAIN_HEX)).toBe('0G Galileo');
  });
  it('is case-insensitive — wallets return mixed casing', () => {
    expect(chainLabel('0xaa36a7')).toBe('Sepolia');
    expect(chainLabel('0x40da')).toBe('0G Galileo');
  });
  it('shows the raw id for anything else rather than pretending', () => {
    expect(chainLabel('0x1')).toBe('Chain 0x1');
  });
  it('says nothing is connected when there is no chain', () => {
    expect(chainLabel(null)).toBe('Not connected');
  });
});

describe('shortenMiddle', () => {
  it('leaves short values alone', () => {
    expect(shortenMiddle('0xabc')).toBe('0xabc');
  });
  it('elides the middle of a long hash', () => {
    const hash = '0x' + 'a'.repeat(64);
    const short = shortenMiddle(hash, 10, 8);
    expect(short).toBe('0xaaaaaaaa…aaaaaaaa');
    expect(short.length).toBeLessThan(hash.length);
  });
  // Artifact (onboarding-ui.tsx) always calls shortenMiddle(value) with no
  // explicit lengths - the defaults are the only behaviour it ever exercises
  // in the running app, so they get their own coverage rather than relying
  // on the explicit-args case above to stand in for them.
  it('defaults to head=10, tail=8 - the only way Artifact actually calls it', () => {
    const hash = '0x' + 'b'.repeat(64);
    expect(shortenMiddle(hash)).toBe(shortenMiddle(hash, 10, 8));
    expect(shortenMiddle(hash)).toBe('0xbbbbbbbb…bbbbbbbb');
  });
  it('sits exactly on the head+tail+1 boundary and leaves it alone', () => {
    const value = 'a'.repeat(10 + 8 + 1); // 19 chars, the <= boundary
    expect(shortenMiddle(value)).toBe(value);
  });
  it('elides one character past the boundary', () => {
    const value = 'a'.repeat(10 + 8 + 2); // 20 chars, one over the boundary
    const short = shortenMiddle(value);
    expect(short).toBe(`${'a'.repeat(10)}…${'a'.repeat(8)}`);
    expect(short.length).toBeLessThan(value.length);
  });
});

describe('domain chips', () => {
  it('parses the same way handleProfileNext does', () => {
    expect(parseDomains(' finance , medicine ,, ')).toEqual(['finance', 'medicine']);
  });
  it('returns an empty list for a blank field', () => {
    expect(parseDomains('   ')).toEqual([]);
  });
  it('round-trips chips back into the comma string the form stores', () => {
    const chips = ['finance', 'medicine'];
    expect(parseDomains(formatDomains(chips))).toEqual(chips);
  });
});

describe('commitChips', () => {
  // The actual bug this branch shipped: DomainChips.commit() used to dedup
  // the new chips against the existing ones but not against each other, so
  // committing "a,a" in one go (a paste, or typing a comma-separated pair)
  // stored "a, a" - two chips sharing a React key.
  it('dedups within a single commit - "a,a" in one go yields one chip', () => {
    expect(commitChips('', 'a,a')).toBe('a');
  });
  it('dedups the new chips against the pre-existing ones', () => {
    expect(commitChips('finance', 'finance, medicine')).toBe('finance, medicine');
  });
  it('preserves insertion order: existing chips first, then new ones in the order they appeared', () => {
    expect(commitChips('finance, medicine', 'law, medicine, art')).toBe('finance, medicine, law, art');
  });
  it('trims whitespace around each chip', () => {
    expect(commitChips('', '  finance ,  medicine  ')).toBe('finance, medicine');
  });
  it('is a no-op on the stored value for an empty or comma-only commit', () => {
    expect(commitChips('finance, medicine', '')).toBe('finance, medicine');
    expect(commitChips('finance, medicine', ' ,, ')).toBe('finance, medicine');
  });
});

describe('guidanceFor', () => {
  it('recognises a MetaMask rejection by numeric code', () => {
    expect(guidanceFor({ code: 4001 })).toMatch(/declined it in MetaMask/);
  });
  it("recognises ethers v6's ACTION_REJECTED string code", () => {
    expect(guidanceFor({ code: 'ACTION_REJECTED' })).toMatch(/declined it in MetaMask/);
  });
  it('points at the signing server when rp-context fails', () => {
    const err = new Error('rp-context signer HTTP 404 - is scripts/onboarding-server.mjs running?');
    expect(guidanceFor(err)).toMatch(/node scripts\/onboarding-server\.mjs/);
  });
  it('points at the runbook when the wallet has no testnet funds', () => {
    expect(guidanceFor({ code: 'INSUFFICIENT_FUNDS' })).toMatch(/docs\/RUNBOOK\.md/);
  });
  it('points at installing/enabling MetaMask when window.ethereum is missing', () => {
    const err = new Error(
      'window.ethereum not found - install/enable MetaMask and reload this page over http://localhost'
    );
    expect(guidanceFor(err)).toMatch(/Install or enable MetaMask/);
  });
  it('offers no guidance rather than a guess for unknown errors', () => {
    expect(guidanceFor(new Error('something entirely new'))).toBeNull();
  });
});

describe('preflightIssues', () => {
  const ok = {
    hasEthereum: true, rpContextOk: true,
    ensName: 'reboleira.eth', worldAppId: 'app_x', worldAction: 'verify-human'
  };
  it('stays silent when everything is in place', () => {
    expect(preflightIssues(ok)).toEqual([]);
  });
  it('flags a missing wallet', () => {
    const [issue] = preflightIssues({ ...ok, hasEthereum: false });
    expect(issue.id).toBe('wallet');
    expect(issue.message).toMatch(/MetaMask/);
  });
  it('flags a server that cannot sign rp_context', () => {
    const [issue] = preflightIssues({ ...ok, rpContextOk: false });
    expect(issue.id).toBe('signer');
    expect(issue.message).toMatch(/onboarding-server\.mjs/);
  });
  it('names every missing build-time config value in one issue', () => {
    const [issue] = preflightIssues({ ...ok, ensName: '', worldAppId: undefined });
    expect(issue.id).toBe('config');
    expect(issue.message).toContain('VITE_ENS_NAME');
    expect(issue.message).toContain('VITE_WORLD_APP_ID');
    expect(issue.message).not.toContain('VITE_WORLD_ACTION');
  });
  it('reports all three categories at once', () => {
    const issues = preflightIssues({ hasEthereum: false, rpContextOk: false, ensName: '' });
    expect(issues.map(i => i.id)).toEqual(['wallet', 'signer', 'config']);
  });
});
