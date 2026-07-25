import type { SpecProvider } from './adapt';
import type { PersonaProfile } from '../core/types';

export async function withFallback<T, F = T>(primary: () => Promise<T>, fallback: () => Promise<F>): Promise<T | F> {
  try { return await primary(); } catch { return await fallback(); }
}

// ---- live/fallback resolvers (Task 16 Part A) ----
//
// Pure, dependency-injected wrappers around withFallback for the two live
// paths content-script.ts wires up. Keeping the decision logic here (instead
// of inline in content-script.ts) makes it unit-testable without chrome.* or
// a DOM: content-script.ts stays thin glue that constructs the real
// collaborators (ENS/0G/chrome.storage.session) and hands them to these.

export interface ResolveProfileDeps {
  /** ENS pointer read -> (cache check ->) sign -> 0G Storage download -> decrypt. */
  loadLiveProfile: () => Promise<PersonaProfile>;
  /** Bundled static demo persona JSON (today's offline behaviour). */
  loadStaticProfile: () => Promise<PersonaProfile>;
}

/**
 * Resolves the active PersonaProfile: tries the live path and falls back to
 * the static demo persona on ANY failure (no ENS pointer yet, RPC down,
 * signature unavailable/rejected, 0G Storage unreachable, ...). The demo
 * must never break because ENS/0G is unavailable.
 */
export async function resolveProfile(deps: ResolveProfileDeps): Promise<PersonaProfile> {
  return withFallback(deps.loadLiveProfile, deps.loadStaticProfile);
}

export interface ResolveSpecDeps {
  /** Live 0G Compute inference request (requestUISpec bound to a broker). */
  requestLiveSpec: SpecProvider;
  /** Pre-computed demo fixture for the current page/persona. */
  getFixtureSpec: SpecProvider;
}

/**
 * Builds the SpecProvider passed to adaptPage: tries live 0G Compute
 * inference and, on ANY error (no funded ledger, network down, malformed
 * model reply, ...), drops to the fixture for the current page/persona. This
 * is the RUNBOOK's documented behaviour ("tries 0G Compute, drops to
 * fixtures on any error").
 */
export function resolveSpec(deps: ResolveSpecDeps): SpecProvider {
  return (graph, profile) => withFallback(
    () => deps.requestLiveSpec(graph, profile),
    () => deps.getFixtureSpec(graph, profile)
  );
}
