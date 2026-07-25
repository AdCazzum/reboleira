import { describe, it, expect } from 'vitest';
import {
  SEPOLIA_CHAIN_HEX, ZEROG_CHAIN_HEX, chainLabel, shortenMiddle,
  parseDomains, formatDomains, guidanceFor, preflightIssues
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
