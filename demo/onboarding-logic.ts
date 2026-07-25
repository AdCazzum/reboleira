// Pure helpers for the onboarding wizard (demo/onboarding.tsx).
//
// Deliberately JSX-free and dependency-free so it can be unit-tested under the
// repo's existing Vitest config (`environment: 'node'`,
// `include: ['tests/**/*.test.ts']`) without a jsdom docblock or any JSX
// transform. Anything here that needs the DOM, the wallet or the network
// belongs in onboarding.tsx or onboarding-ui.tsx instead — this module takes
// plain values in and returns plain values out.

// CONFIG.zerogChainId (16602) as 0x-hex, and Sepolia's well-known chain id.
export const ZEROG_CHAIN_HEX = '0x40DA';
export const SEPOLIA_CHAIN_HEX = '0xAA36A7';

/** Human name for a wallet's active chain. Unknown chains show their raw id
 *  rather than a reassuring guess — during the demo, "which network am I on"
 *  is exactly the question the badge exists to answer honestly. */
export function chainLabel(chainIdHex: string | null): string {
  if (!chainIdHex) return 'Not connected';
  const id = chainIdHex.toLowerCase();
  if (id === SEPOLIA_CHAIN_HEX.toLowerCase()) return 'Sepolia';
  if (id === ZEROG_CHAIN_HEX.toLowerCase()) return '0G Galileo';
  return `Chain ${chainIdHex}`;
}

/** Elides the middle of long on-chain values so they fit on one line. The full
 *  value always stays available via the copy button next to it. */
export function shortenMiddle(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** The exact parse handleProfileNext applies to the domains field. The chip
 *  input keeps the comma-joined string as its source of truth so that parse
 *  stays the single authority on what gets stored. */
export function parseDomains(input: string): string[] {
  return input.split(',').map(s => s.trim()).filter(Boolean);
}

export function formatDomains(chips: string[]): string {
  return chips.join(', ');
}

/** Merges a freshly-committed chip draft (e.g. a paste or a typed
 *  comma-separated pair, "a,a") into the existing comma-joined domains
 *  string, deduplicating the WHOLE union - not just the new chips against
 *  the old ones - so committing "a,a" in one go cannot itself produce two
 *  chips that share a key. Returns the existing value unchanged (a no-op)
 *  when the raw commit parses to nothing (empty or comma/whitespace-only).
 *  Insertion order is preserved (existing chips first, then new ones in the
 *  order they appeared in `raw`), and every chip is trimmed by
 *  `parseDomains`. Stays a string in, string out: `domainsInput` (and
 *  handleProfileNext's `split(',')` parse of it) remain the single
 *  authority on what gets stored - DomainChips.commit() in
 *  onboarding-ui.tsx just calls this instead of reimplementing the merge. */
export function commitChips(existingCsv: string, raw: string): string {
  const existing = parseDomains(existingCsv);
  const next = parseDomains(raw);
  if (next.length === 0) return existingCsv;
  return formatDomains([...new Set([...existing, ...next])]);
}

function errorCode(err: unknown): string | number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { code?: string | number; info?: { error?: { code?: number } } };
  return e.code ?? e.info?.error?.code;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** One actionable line for the failures a demo actually hits. Returns null for
 *  anything unrecognised — a wrong suggestion is worse than none, and the raw
 *  message is always shown alongside this regardless. */
export function guidanceFor(err: unknown): string | null {
  const code = errorCode(err);
  const message = errorMessage(err);

  if (code === 4001 || code === 'ACTION_REJECTED' || /user rejected|user denied/i.test(message)) {
    return 'You declined it in MetaMask. Click again when you are ready.';
  }
  if (/rp-context/i.test(message)) {
    return 'The World ID signing server is not answering. Start it from the repo root: node scripts/onboarding-server.mjs';
  }
  if (code === 'INSUFFICIENT_FUNDS' || /insufficient funds/i.test(message)) {
    return 'This wallet has no testnet funds on that network. See docs/RUNBOOK.md for the faucets.';
  }
  if (/window\.ethereum not found/i.test(message)) {
    return 'Install or enable MetaMask, then reload this page over http://localhost.';
  }
  return null;
}

export interface PreflightDeps {
  hasEthereum: boolean;
  rpContextOk: boolean;
  ensName?: string;
  worldAppId?: string;
  worldAction?: string;
}

export interface PreflightIssue {
  id: 'wallet' | 'signer' | 'config';
  message: string;
}

/** Checks run once on mount. These warn, they never block: the point is to
 *  surface a broken setup before a wallet is connected rather than halfway
 *  through a live demo. */
export function preflightIssues(deps: PreflightDeps): PreflightIssue[] {
  const issues: PreflightIssue[] = [];

  if (!deps.hasEthereum) {
    issues.push({
      id: 'wallet',
      message: 'MetaMask was not detected. Install or enable it, then reload this page over http://localhost.'
    });
  }

  if (!deps.rpContextOk) {
    issues.push({
      id: 'signer',
      message: 'Step 2 will fail: this page is not being served by scripts/onboarding-server.mjs, so POST /rp-context has nothing to sign World ID requests.'
    });
  }

  // CONFIG is inlined at build time, so a missing value cannot be fixed by
  // restarting anything — the bundle has to be rebuilt.
  const missing = [
    ['VITE_ENS_NAME', deps.ensName],
    ['VITE_WORLD_APP_ID', deps.worldAppId],
    ['VITE_WORLD_ACTION', deps.worldAction]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    issues.push({
      id: 'config',
      message: `Missing from .env at build time: ${missing.join(', ')}. Fill it in and re-run: node scripts/build-onboarding.mjs`
    });
  }

  return issues;
}
