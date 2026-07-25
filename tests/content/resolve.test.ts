// @vitest-environment jsdom
//
// Unit tests for the pure, dependency-injected live/fallback resolvers used
// by content-script.ts (Task 16 Part A). content-script.ts itself is chrome/DOM
// glue and is not unit-tested (see tests/content/fallback.test.ts for the same
// rationale re: withFallback); these test the decision logic in isolation
// with plain function collaborators, no chrome/ethers/network involved.
import { describe, it, expect } from 'vitest';
import { resolveProfile, resolveSpec } from '../../src/content/content-script-helpers';
import type { PersonaProfile } from '../../src/core/types';

const staticProfile: PersonaProfile = {
  version: 1, language: 'it', readingLevel: 'simple',
  accessibility: { dyslexiaFriendly: false, highContrast: false, largeText: false, reduceClutter: false },
  expertiseDomains: [], tone: 'plain'
};
const liveProfile: PersonaProfile = { ...staticProfile, language: 'en' };

describe('resolveProfile', () => {
  it('usa il profilo statico se il caricamento live rigetta', async () => {
    const p = await resolveProfile({
      loadLiveProfile: async () => { throw new Error('ENS/0G down'); },
      loadStaticProfile: async () => staticProfile
    });
    expect(p).toEqual(staticProfile);
  });

  it('usa il profilo live se il caricamento live ha successo', async () => {
    const p = await resolveProfile({
      loadLiveProfile: async () => liveProfile,
      loadStaticProfile: async () => staticProfile
    });
    expect(p).toEqual(liveProfile);
  });
});

describe('resolveSpec', () => {
  const graph = { url: 'http://x/page-a', title: 't', blocks: [] };

  it('usa la fixture se la richiesta live a 0G Compute rigetta', async () => {
    const getSpec = resolveSpec({
      requestLiveSpec: async () => { throw new Error('no funded ledger'); },
      getFixtureSpec: async () => ({ fixture: true })
    });
    const spec = await getSpec(graph, staticProfile);
    expect(spec).toEqual({ fixture: true });
  });

  it('usa la spec live se la richiesta a 0G Compute ha successo', async () => {
    const getSpec = resolveSpec({
      requestLiveSpec: async () => ({ live: true }),
      getFixtureSpec: async () => ({ fixture: true })
    });
    const spec = await getSpec(graph, staticProfile);
    expect(spec).toEqual({ live: true });
  });

  it('passa graph e profile inalterati al fetcher live', async () => {
    let seen: unknown[] = [];
    const getSpec = resolveSpec({
      requestLiveSpec: async (g, p) => { seen = [g, p]; return { live: true }; },
      getFixtureSpec: async () => ({ fixture: true })
    });
    await getSpec(graph, staticProfile);
    expect(seen).toEqual([graph, staticProfile]);
  });
});
