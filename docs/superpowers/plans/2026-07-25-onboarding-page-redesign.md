# Onboarding Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the presentation layer of the five-step onboarding wizard (`demo/onboarding.html` + `demo/onboarding.tsx`) so it is legible, usable and demo-ready, without touching the live on-chain flow.

**Architecture:** Pure helpers move to a JSX-free `demo/onboarding-logic.ts` (unit-testable under the existing Vitest config). Presentational Preact components move to `demo/onboarding-ui.tsx`. `demo/onboarding.tsx` keeps only the five async handlers and its header comment. Styling is a hand-written `demo/onboarding.css` linked from the HTML — never imported from the `.tsx`.

**Tech Stack:** Preact 10 · TypeScript · Vite (via `scripts/build-onboarding.mjs`) · Vitest 4 (node env) · Playwright 1.62 (verification) · ethers v6 · `@worldcoin/idkit` 4.2.1

## Global Constraints

- **The live flow is untouchable.** No wallet call, chain switch, signature, encryption step, upload or transaction in `handleConnect`, `openWorldWidget`, `handleWorldSuccess`, `handleWorldError`, `handleEncryptUpload`, `handleWriteEns`, `switchChain`, `extractNullifier` or `refreshSigner` changes — not its order, its arguments or its error handling. The `humanTxHash` / `profileTxHash` retry guards, the `IDKitRequestWidget` props and the shape of `PersonaProfile` are likewise fixed.
- **Exactly two mechanical edits inside those handlers are permitted**, both enumerated in the tasks below and nothing else: replacing the four `setStep(n)` calls with `advance(n)` (Task 3, Step 2) and changing what `logError` *returns* while leaving what it logs identical (Task 4, Step 4). Any other diff inside a handler body is a mistake.
- **Do not modify** `scripts/build-onboarding.mjs`, `scripts/onboarding-server.mjs`, `src/**`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` or `package.json`.
- **CSS is never imported from a `.tsx`.** `scripts/build-onboarding.mjs` pins `entryFileNames: 'onboarding.js'`; a CSS import emits a separate hashed asset the HTML never references, so the styles would silently vanish with a green build. `demo/onboarding.css` is hand-written and `<link>`ed from `demo/onboarding.html`.
- **`demo/onboarding.js` is tracked in git.** Every task that changes `.tsx` must re-run `node scripts/build-onboarding.mjs` and commit the rebuilt bundle. `demo/assets/**` may also change; commit whatever the build emits.
- **Copy is in English**, matching README / RUNBOOK / DEMO-SCRIPT.
- **Design tokens are the only source of colour, spacing and type size.** No hard-coded hex values outside `:root` in `demo/onboarding.css`. Forbidden: gradients, glassmorphism, decorative shadows, emoji as icons, marketing hero copy.
- **Accessibility is a requirement.** Stepper is an `<ol>` with `aria-current="step"`; error blocks are `role="alert"`; the log is `aria-live="polite"`; in-flight steps set `aria-busy`; `:focus-visible` is styled on every interactive element; accessibility options are real `<input type="checkbox">`; all text meets 4.5:1 contrast. Motion only inside `@media (prefers-reduced-motion: no-preference)`.
- **Unit tests live in `tests/**/*.test.ts`** (Vitest `include`), run under `environment: 'node'` unless the file opens with the `// @vitest-environment jsdom` docblock.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `demo/onboarding-logic.ts` | Create | Pure, JSX-free helpers: chain labels, error guidance, domain parsing, preflight rules. The only unit-tested part. |
| `tests/demo/onboarding-logic.test.ts` | Create | Vitest coverage for the above. |
| `demo/onboarding.css` | Create | Design tokens and every component style. |
| `demo/onboarding-ui.tsx` | Create | Presentational Preact components. No network, no wallet, no `src/` service imports except `theme.ts`. |
| `demo/onboarding.html` | Modify | Static shell, `<link>` to the stylesheet, dev prose moved into a `<details>`. |
| `demo/onboarding.tsx` | Modify | Flow logic only: the five handlers plus state. Renders components from `onboarding-ui.tsx`. |
| `scripts/preview-onboarding.mjs` | Create | Playwright harness: serves `demo/`, stubs `window.ethereum`, screenshots each step. |
| `demo/onboarding.js`, `demo/assets/**` | Rebuilt | Build output, tracked in git. |

---

### Task 1: Pure logic module

**Files:**
- Create: `demo/onboarding-logic.ts`
- Test: `tests/demo/onboarding-logic.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SEPOLIA_CHAIN_HEX: '0xAA36A7'`, `ZEROG_CHAIN_HEX: '0x40DA'`
  - `chainLabel(chainIdHex: string | null): string`
  - `shortenMiddle(value: string, head?: number, tail?: number): string`
  - `parseDomains(input: string): string[]`
  - `formatDomains(chips: string[]): string`
  - `guidanceFor(err: unknown): string | null`
  - `interface PreflightDeps { hasEthereum: boolean; rpContextOk: boolean; ensName?: string; worldAppId?: string; worldAction?: string }`
  - `interface PreflightIssue { id: 'wallet' | 'signer' | 'config'; message: string }`
  - `preflightIssues(deps: PreflightDeps): PreflightIssue[]`

- [ ] **Step 1: Write the failing test**

Create `tests/demo/onboarding-logic.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/demo/onboarding-logic.test.ts`
Expected: FAIL — `Failed to resolve import "../../demo/onboarding-logic"`.

- [ ] **Step 3: Write the implementation**

Create `demo/onboarding-logic.ts`:

```ts
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
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/demo/onboarding-logic.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Run the whole suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS, no new failures versus the pre-task baseline.

- [ ] **Step 6: Commit**

```bash
git add demo/onboarding-logic.ts tests/demo/onboarding-logic.test.ts
git commit -m "feat(onboarding): helper puri per chain, errori e preflight"
```

---

### Task 2: Static shell and stylesheet

**Files:**
- Create: `demo/onboarding.css`
- Create: `scripts/preview-onboarding.mjs`
- Modify: `demo/onboarding.html`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the class names every later task uses. The full list is in the stylesheet below; later tasks must not invent class names that are not defined here.

- [ ] **Step 1: Write the stylesheet**

Create `demo/onboarding.css`:

```css
/* Onboarding wizard styles.
 *
 * Hand-written and linked from onboarding.html rather than imported from
 * onboarding.tsx on purpose: scripts/build-onboarding.mjs pins
 * entryFileNames:'onboarding.js' for a single entry, so an imported
 * stylesheet would be emitted as a separate hashed asset that the HTML never
 * references — the page would render unstyled with a perfectly green build.
 *
 * Every colour, size and space is a token below. Monospace is reserved for
 * literal on-chain values (addresses, hashes, tx ids, record keys) so that
 * typeface carries meaning instead of decoration. */

:root {
  --ink: #14161a;
  --muted: #5c6470;
  --hairline: #e2e5ea;
  --surface: #ffffff;
  --canvas: #f7f8fa;
  --ok: #137333;
  --err: #a50e0e;
  --link: #0b57d0;
  --warn-bg: #fdf6e3;
  --warn-border: #e8d8a8;

  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px;
  --s5: 24px; --s6: 32px; --s7: 48px;

  --t-xs: 13px; --t-s: 15px; --t-m: 17px; --t-l: 22px; --t-xl: 32px;

  --radius: 6px;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  --col: 680px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font: var(--t-s)/1.55 var(--sans);
  -webkit-font-smoothing: antialiased;
}

a { color: var(--link); }

:focus-visible {
  outline: 2px solid var(--link);
  outline-offset: 2px;
  border-radius: 2px;
}

/* ---- header ---- */

.masthead {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--s4);
  padding: var(--s3) var(--s5);
  background: var(--surface);
  border-bottom: 1px solid var(--hairline);
}

.masthead__mark {
  font-weight: 650;
  letter-spacing: -0.01em;
  margin-right: auto;
}

.masthead__meta {
  display: flex;
  align-items: center;
  gap: var(--s4);
  font-size: var(--t-xs);
  color: var(--muted);
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--s2);
  padding: var(--s1) var(--s3);
  border: 1px solid var(--hairline);
  border-radius: 999px;
  white-space: nowrap;
}

.badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
}

.badge--live .badge__dot { background: var(--ok); }

.badge__value { font-family: var(--mono); color: var(--ink); }

/* ---- page frame ---- */

.frame {
  max-width: var(--col);
  margin: 0 auto;
  padding: var(--s7) var(--s5) var(--s7);
}

.lede__title {
  font-size: var(--t-xl);
  line-height: 1.2;
  letter-spacing: -0.02em;
  margin: 0 0 var(--s3);
}

.lede__promise {
  font-size: var(--t-m);
  color: var(--muted);
  margin: 0 0 var(--s6);
  max-width: 52ch;
}

/* ---- stepper ---- */

.stepper {
  display: flex;
  list-style: none;
  margin: 0 0 var(--s5);
  padding: 0;
}

.stepper__item { flex: 1; min-width: 0; }

.stepper__btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0 var(--s2) var(--s2) 0;
  background: none;
  border: 0;
  border-top: 2px solid var(--hairline);
  color: var(--muted);
  font: inherit;
  font-size: var(--t-xs);
  cursor: default;
}

.stepper__btn[data-reachable="true"] { cursor: pointer; }

.stepper__item[data-state="done"] .stepper__btn {
  border-top-color: var(--ok);
  color: var(--ok);
}

.stepper__item[data-state="current"] .stepper__btn {
  border-top-color: var(--ink);
  color: var(--ink);
  font-weight: 600;
}

.stepper__n { font-variant-numeric: tabular-nums; margin-right: var(--s1); }

.stepper__label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- card ---- */

.card {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  padding: var(--s6);
}

.card[aria-busy="true"] { opacity: 0.75; }

.card__title {
  font-size: var(--t-l);
  line-height: 1.25;
  letter-spacing: -0.01em;
  margin: 0 0 var(--s2);
}

.card__why {
  color: var(--muted);
  margin: 0 0 var(--s5);
  max-width: 56ch;
}

/* ---- controls ---- */

.btn {
  font: inherit;
  font-weight: 550;
  padding: 10px var(--s5);
  border-radius: var(--radius);
  border: 1px solid var(--ink);
  background: var(--ink);
  color: var(--surface);
  cursor: pointer;
}

.btn:hover:not(:disabled) { background: #000; }

.btn:disabled { opacity: 0.45; cursor: not-allowed; }

.btn--quiet {
  background: var(--surface);
  color: var(--ink);
  border-color: var(--hairline);
}

.btn--quiet:hover:not(:disabled) { border-color: var(--muted); background: var(--canvas); }

.btn--tiny {
  padding: 2px var(--s2);
  font-size: var(--t-xs);
  font-weight: 500;
}

.field { display: block; margin-bottom: var(--s5); }

.field__label {
  display: block;
  font-weight: 600;
  margin-bottom: var(--s1);
}

.field__hint {
  display: block;
  color: var(--muted);
  font-size: var(--t-xs);
  margin-bottom: var(--s2);
}

.input, .select {
  font: inherit;
  width: 100%;
  padding: var(--s2) var(--s3);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
}

/* ---- artifact (a literal on-chain value) ---- */

.artifact {
  display: flex;
  align-items: baseline;
  gap: var(--s3);
  padding: var(--s3) 0;
  border-top: 1px solid var(--hairline);
}

.artifact__label {
  flex: 0 0 132px;
  font-size: var(--t-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.artifact__value {
  flex: 1;
  min-width: 0;
  font-family: var(--mono);
  font-size: var(--t-xs);
  word-break: break-all;
}

/* ---- error ---- */

.error {
  margin-top: var(--s5);
  padding: var(--s4);
  border: 1px solid var(--err);
  border-left-width: 3px;
  border-radius: var(--radius);
  background: var(--surface);
}

.error__summary { font-weight: 600; color: var(--err); margin: 0 0 var(--s2); }

.error__raw {
  font-family: var(--mono);
  font-size: var(--t-xs);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0 0 var(--s3);
}

.error__guidance { margin: 0 0 var(--s3); }

/* ---- preflight ---- */

.preflight {
  margin-bottom: var(--s5);
  padding: var(--s4);
  border: 1px solid var(--warn-border);
  border-radius: var(--radius);
  background: var(--warn-bg);
}

.preflight__title { font-weight: 600; margin: 0 0 var(--s2); }

.preflight__list { margin: 0; padding-left: var(--s5); }

.preflight__list li + li { margin-top: var(--s2); }

/* ---- disclosures ---- */

.disclosure {
  margin-top: var(--s4);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface);
}

.disclosure > summary {
  padding: var(--s3) var(--s4);
  cursor: pointer;
  font-size: var(--t-xs);
  font-weight: 600;
  color: var(--muted);
}

.disclosure > summary::marker { color: var(--muted); }

.disclosure__body { padding: 0 var(--s4) var(--s4); }

.disclosure__body p { color: var(--muted); font-size: var(--t-xs); }

.log {
  max-height: 320px;
  overflow: auto;
  margin: 0;
  padding: var(--s3);
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  font-family: var(--mono);
  font-size: var(--t-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--ink);
}

/* ---- step 3: choices ---- */

.choices { border: 0; margin: 0 0 var(--s5); padding: 0; }

.choices__legend { font-weight: 600; padding: 0; margin-bottom: var(--s2); }

.choice {
  display: flex;
  gap: var(--s3);
  align-items: flex-start;
  padding: var(--s3);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  cursor: pointer;
}

.choice + .choice { margin-top: var(--s2); }

.choice:has(:checked) { border-color: var(--ink); }

.choice__text { display: block; }

.choice__name { display: block; font-weight: 550; }

.choice__effect { display: block; color: var(--muted); font-size: var(--t-xs); }

/* ---- step 3: chips ---- */

.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s2);
  padding: var(--s2);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface);
}

.chips:focus-within { border-color: var(--ink); }

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--s2);
  padding: 2px var(--s2);
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: 999px;
  font-size: var(--t-xs);
}

.chip__remove {
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  color: var(--muted);
  font: inherit;
  line-height: 1;
}

.chips__input {
  flex: 1;
  min-width: 8ch;
  border: 0;
  padding: var(--s1);
  font: inherit;
  background: none;
  color: var(--ink);
}

.chips__input:focus { outline: none; }

/* ---- step 3: live preview ---- */

.preview {
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: var(--s5);
}

.preview__caption {
  padding: var(--s2) var(--s3);
  background: var(--canvas);
  border-bottom: 1px solid var(--hairline);
  font-size: var(--t-xs);
  color: var(--muted);
}

/* The inner surface is driven entirely by the CSS custom properties returned
 * by themeToCssVars() in src/core/theme.ts — the same mapping the extension
 * applies to a real page. Nothing here re-implements it. */
.preview__surface {
  padding: var(--s4);
  background: var(--ens-bg, var(--surface));
  color: var(--ens-fg, var(--ink));
  font-family: var(--ens-font-family, var(--sans));
  line-height: var(--ens-line-spacing, 1.55);
}

.preview__surface h4 {
  margin: 0 0 var(--ens-gap, var(--s3));
  font-size: calc(var(--t-m) * var(--ens-font-scale, 1));
}

.preview__surface p {
  margin: 0;
  font-size: calc(var(--t-s) * var(--ens-font-scale, 1));
}

/* ---- summary ---- */

.summary__done {
  display: flex;
  align-items: center;
  gap: var(--s2);
  color: var(--ok);
  font-weight: 600;
  margin: 0 0 var(--s5);
}

.summary__links { margin: var(--s5) 0 0; padding: 0; list-style: none; }

.summary__links li + li { margin-top: var(--s2); }

/* ---- motion ---- */

@media (prefers-reduced-motion: no-preference) {
  .card { transition: opacity 150ms ease; }
  .choice, .btn, .input, .select { transition: border-color 120ms ease, background-color 120ms ease; }
}

@media (max-width: 620px) {
  .frame { padding: var(--s5) var(--s4); }
  .card { padding: var(--s5) var(--s4); }
  .artifact { display: block; }
  .artifact__label { margin-bottom: var(--s1); }
  .stepper__label { display: none; }
}
```

- [ ] **Step 2: Rewrite the HTML shell**

Replace the whole of `demo/onboarding.html` with:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ENSight — publish your profile</title>
<link rel="stylesheet" href="./onboarding.css" />
</head>
<body>
<header class="masthead">
  <span class="masthead__mark">ENSight</span>
  <div class="masthead__meta" id="masthead-meta"></div>
</header>

<main class="frame">
  <h1 class="lede__title">Publish your profile</h1>
  <p class="lede__promise">
    Your profile is encrypted in your browser. The plaintext never leaves this
    device — ENS only ever holds a pointer to it, plus a proof that you are a
    unique human.
  </p>

  <div id="app"></div>

  <details class="disclosure" id="setup-notes">
    <summary>Local setup</summary>
    <div class="disclosure__body">
      <p>
        Dev/test harness — not part of the shipped extension. This standalone
        Preact page runs the real end-to-end profile setup against the real
        <code>src/core/crypto.ts</code>, <code>src/services/world-id.ts</code>,
        <code>src/services/zerog-storage.ts</code> and <code>src/config.ts</code>
        (no copies, no mocks).
      </p>
      <p>
        Serve this directory over <code>http://localhost</code> (not
        <code>file://</code>) so MetaMask injects <code>window.ethereum</code>
        reliably. Use <code>node scripts/onboarding-server.mjs</code> from the
        repo root, then open
        <code>http://localhost:8080/onboarding.html</code>. A generic static
        server (e.g. <code>npx serve demo</code>) will <strong>not</strong>
        work for step 2: that step fetches <code>POST /rp-context</code> from
        the same origin, which only <code>scripts/onboarding-server.mjs</code>
        provides (it signs the request in Node, because
        <code>@worldcoin/idkit/signing</code>'s <code>signRequest()</code>
        refuses to run in a browser), and a generic server may also serve
        <code>.wasm</code> with the wrong MIME type, which breaks idkit's WASM
        module.
      </p>
      <p>
        Requires a <code>.env</code> filled in per <code>.env.example</code>
        <em>before building</em> — <code>CONFIG</code> is inlined at build time
        by <code>node scripts/build-onboarding.mjs</code> — and
        <code>WORLD_RP_SIGNING_KEY</code> / <code>WORLD_RP_ID</code> set (env or
        that same <code>.env</code>) before starting the server, for step 2
        specifically.
      </p>
    </div>
  </details>
</main>

<script type="module" src="./onboarding.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write the preview harness**

Create `scripts/preview-onboarding.mjs`:

```js
// Renders demo/onboarding.html in a real Chromium and writes a screenshot per
// screen, so the wizard's layout can be verified without a wallet, testnet
// funds or the World ID simulator.
//
// Serves demo/ itself rather than reusing scripts/onboarding-server.mjs: that
// server exits fatally without WORLD_RP_SIGNING_KEY/WORLD_RP_ID, which this
// harness has no business needing. It answers OPTIONS /rp-context with 204,
// exactly as the real server does, so the page's preflight signer check
// passes here too.
//
// Usage: node scripts/preview-onboarding.mjs [outDir]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const demoDir = join(root, 'demo');
const outDir = resolve(process.argv[2] ?? join(root, 'demo-preview'));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png'
};

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/rp-context') {
    res.writeHead(req.method === 'OPTIONS' ? 204 : 501).end();
    return;
  }
  try {
    const file = join(demoDir, path === '/' ? 'onboarding.html' : path.replace(/^\/+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// A wallet stub good enough to walk the UI: it answers the four RPC methods
// the wizard calls before it needs a real signature, and never signs anything.
const WALLET_STUB = `
  window.ethereum = {
    isMetaMask: true,
    _chainId: '0xAA36A7',
    request: async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts')
        return ['0x1111111111111111111111111111111111111111'];
      if (method === 'eth_chainId') return window.ethereum._chainId;
      if (method === 'net_version') return '11155111';
      return null;
    },
    on: () => {}, removeListener: () => {}
  };
`;

await mkdir(outDir, { recursive: true });
await new Promise(done => server.listen(0, done));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));

await page.addInitScript(WALLET_STUB);
await page.goto(`${base}/onboarding.html`);
await page.waitForSelector('.stepper', { timeout: 15_000 });

const shots = [];
async function shoot(name) {
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(file);
}

await shoot('01-step1-connect');

await page.getByRole('button', { name: /connect wallet/i }).click();
await page.waitForSelector('[data-step="2"]', { timeout: 15_000 });
await shoot('02-step2-verify');

// Jump straight to step 3: step 2 needs the World ID simulator, which this
// harness deliberately does not stand up.
await page.evaluate(() => window.__ensightGoToStep?.(3));
await page.waitForSelector('[data-step="3"]', { timeout: 15_000 });
await shoot('03-step3-profile');

await page.getByRole('checkbox', { name: /larger text/i }).check();
await page.getByRole('checkbox', { name: /dyslexia/i }).check();
await shoot('04-step3-preview-adapted');

await page.locator('#log-disclosure summary').click();
await shoot('05-log-open');

await browser.close();
await new Promise(done => server.close(done));

console.log(`Screenshots written to ${outDir}:`);
for (const s of shots) console.log(`  ${s}`);
if (errors.length > 0) {
  console.error(`\n${errors.length} console/page error(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log('\nNo console or page errors.');
```

- [ ] **Step 4: Ignore the screenshot output directory**

Append `demo-preview` to `.gitignore` (one line, at the end).

- [ ] **Step 5: Verify the shell renders**

Run:

```bash
node scripts/build-onboarding.mjs
node scripts/preview-onboarding.mjs
```

Expected: the script fails at `page.waitForSelector('.stepper')` — the app still renders the old inline-styled markup and has no `.stepper` class yet. That is correct at this point in the plan. Verify the *shell* by hand instead:

```bash
node scripts/onboarding-server.mjs   # then open http://localhost:8080/onboarding.html
```

Expected: styled masthead, title, promise line, and a closed "Local setup" disclosure containing the three setup paragraphs. The wizard below is still the old unstyled markup.

- [ ] **Step 6: Commit**

```bash
git add demo/onboarding.css demo/onboarding.html scripts/preview-onboarding.mjs .gitignore
git commit -m "feat(onboarding): shell statica, design token e harness di anteprima"
```

---

### Task 3: Shell components and steps 1, 2, 4, 5

**Files:**
- Create: `demo/onboarding-ui.tsx`
- Modify: `demo/onboarding.tsx`

**Interfaces:**
- Consumes: `chainLabel`, `shortenMiddle`, `SEPOLIA_CHAIN_HEX`, `ZEROG_CHAIN_HEX` from `demo/onboarding-logic.ts`; the class names from `demo/onboarding.css`.
- Produces, from `demo/onboarding-ui.tsx`:
  - `MastheadMeta({ ensName, chainId, address })`
  - `Stepper({ steps, current, furthest, onSelect })` where `steps: { n: number; label: string }[]` and `onSelect: (n: number) => void`
  - `StepCard({ n, title, why, busy, children })`
  - `Artifact({ label, value, href })`
  - `LogPanel({ lines })` where `lines: string[]`

- [ ] **Step 1: Write the presentational components**

Create `demo/onboarding-ui.tsx`:

```tsx
// Presentational components for the onboarding wizard.
//
// Split out of demo/onboarding.tsx so that file stays focused on the five
// async handlers that drive the live chain flow. Nothing here talks to the
// wallet, the network or any src/services module — components take values in
// and render them. The one src/ import is src/core/theme.ts, used by the
// step-3 preview to apply the REAL profile->theme mapping rather than a
// mock-up of it.
import type { ComponentChildren } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { chainLabel, shortenMiddle } from './onboarding-logic';

export function MastheadMeta({ ensName, chainId, address }: {
  ensName: string;
  chainId: string | null;
  address: string | null;
}) {
  return (
    <>
      <span class="badge">
        <span class="badge__value">{ensName || '(VITE_ENS_NAME not set)'}</span>
      </span>
      <span class={address ? 'badge badge--live' : 'badge'}>
        <span class="badge__dot" />
        {chainLabel(chainId)}
      </span>
      {address && (
        <span class="badge">
          <span class="badge__value">{shortenMiddle(address, 6, 4)}</span>
        </span>
      )}
    </>
  );
}

export function Stepper({ steps, current, furthest, onSelect }: {
  steps: { n: number; label: string }[];
  current: number;
  furthest: number;
  onSelect: (n: number) => void;
}) {
  return (
    <ol class="stepper">
      {steps.map(s => {
        const state = s.n === current ? 'current' : s.n < furthest || s.n < current ? 'done' : 'todo';
        const reachable = s.n <= furthest && s.n !== current;
        return (
          <li key={s.n} class="stepper__item" data-state={state}>
            <button
              type="button"
              class="stepper__btn"
              data-reachable={String(reachable)}
              disabled={!reachable}
              aria-current={s.n === current ? 'step' : undefined}
              onClick={() => reachable && onSelect(s.n)}
            >
              <span class="stepper__n">{s.n}</span>
              <span class="stepper__label">{s.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function StepCard({ n, title, why, busy, children }: {
  n: number;
  title: string;
  why: ComponentChildren;
  busy?: boolean;
  children: ComponentChildren;
}) {
  return (
    <section class="card" data-step={n} aria-busy={busy ? 'true' : undefined}>
      <h2 class="card__title">{title}</h2>
      <p class="card__why">{why}</p>
      {children}
    </section>
  );
}

/** A literal on-chain value: monospace, elided in the middle, copyable in full. */
export function Artifact({ label, value, href }: { label: string; value: string; href?: string }) {
  const [copied, setCopied] = useState(false);
  const shown = shortenMiddle(value);
  return (
    <div class="artifact">
      <span class="artifact__label">{label}</span>
      <span class="artifact__value">
        {href ? <a href={href} target="_blank" rel="noreferrer">{shown}</a> : shown}
      </span>
      <button
        type="button"
        class="btn btn--quiet btn--tiny"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
            () => {}
          );
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function LogPanel({ lines }: { lines: string[] }) {
  const pre = useRef<HTMLPreElement>(null);
  // Follow the tail as lines arrive, so a long-running step (the 0G upload,
  // waiting on a receipt) shows its latest line without a manual scroll.
  useEffect(() => {
    const el = pre.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <details class="disclosure" id="log-disclosure">
      <summary>Technical log ({lines.length})</summary>
      <div class="disclosure__body">
        <pre class="log" ref={pre} aria-live="polite">{lines.join('\n')}</pre>
      </div>
    </details>
  );
}
```

- [ ] **Step 2: Rewire `onboarding.tsx` — imports, constants and state**

In `demo/onboarding.tsx`:

Append this paragraph to the end of the existing header comment block, immediately above the `import` statements. Do not delete or reword anything already there.

```
// ---------------------------------------------------------------------------
// UI layer: this file owns the flow (the five handlers and their state) and
// nothing else. Presentation lives in demo/onboarding-ui.tsx, pure helpers in
// demo/onboarding-logic.ts, and styling in demo/onboarding.css — which is
// linked from onboarding.html rather than imported here, because
// scripts/build-onboarding.mjs pins a single `onboarding.js` output and would
// emit an imported stylesheet as an unreferenced hashed asset.
// ---------------------------------------------------------------------------
```

Delete the local `ZEROG_CHAIN_HEX` / `SEPOLIA_CHAIN_HEX` consts and the `Stepper` and `ErrorBox` function declarations. Add to the imports:

```tsx
import { SEPOLIA_CHAIN_HEX, ZEROG_CHAIN_HEX } from './onboarding-logic';
import { MastheadMeta, Stepper, StepCard, Artifact, LogPanel } from './onboarding-ui';
```

Change the `STEPS` labels to the ones the design calls for, keeping the same five entries and `StepNum` type:

```tsx
const STEPS: { n: StepNum; label: string }[] = [
  { n: 1, label: 'Wallet' },
  { n: 2, label: 'Human' },
  { n: 3, label: 'Profile' },
  { n: 4, label: 'Encrypt' },
  { n: 5, label: 'ENS' }
];
```

Inside `App()`, add next to the existing `step` state:

```tsx
const [furthest, setFurthest] = useState<StepNum>(1);
const [chainId, setChainId] = useState<string | null>(null);

// Forward movement always goes through here so `furthest` can never fall
// behind `step` — the stepper uses it to decide which steps are reachable.
function advance(n: StepNum): void {
  setStep(n);
  setFurthest(f => (n > f ? n : f));
}
```

Replace every `setStep(n)` call inside the five handlers with `advance(n)` — there are four: `setStep(2)` in `handleConnect`, `setStep(3)` in `handleWorldSuccess`, `setStep(4)` in `handleProfileNext`, `setStep(5)` in `handleEncryptUpload`. Change nothing else inside those handlers.

Add the chain watcher and the debug hook after the existing `useRef` declarations:

```tsx
// Keeps the network badge honest. The wizard switches chains twice
// (0G Galileo for the upload, back to Sepolia for the ENS write), and
// MetaMask can also be switched by hand mid-run.
useEffect(() => {
  const eth = (window as any).ethereum;
  if (!eth) return;
  const read = () => eth.request({ method: 'eth_chainId' }).then(setChainId).catch(() => {});
  const onChanged = (id: string) => setChainId(id);
  read();
  eth.on?.('chainChanged', onChanged);
  return () => eth.removeListener?.('chainChanged', onChanged);
}, [address]);

// Lets scripts/preview-onboarding.mjs reach a step that would otherwise need
// the World ID simulator. Test seam only — nothing in the flow calls it.
useEffect(() => {
  (window as any).__ensightGoToStep = (n: StepNum) => advance(n);
}, []);
```

Add `useEffect` to the existing `preact/hooks` import.

Also render the masthead metadata into the static header, after the two effects above:

```tsx
useEffect(() => {
  const slot = document.getElementById('masthead-meta');
  if (slot) render(<MastheadMeta ensName={CONFIG.ensName} chainId={chainId} address={address} />, slot);
}, [chainId, address]);
```

- [ ] **Step 3: Rewrite the JSX for steps 1, 2, 4 and 5**

Replace the `return (...)` block of `App()` with the following. Steps 3 and the completion summary are placeholders wired in by Tasks 5 and 6; the step-3 `<form>` markup is carried over verbatim from the current file for now.

```tsx
  return (
    <>
      <Stepper steps={STEPS} current={step} furthest={furthest} onSelect={n => setStep(n as StepNum)} />

      {step === 1 && (
        <StepCard n={1} busy={busy} title="Connect your wallet"
          why="The same wallet signs the key that encrypts your profile and, at the end, the two ENS records that point at it.">
          <button class="btn" onClick={handleConnect} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect wallet'}
          </button>
          {address && <Artifact label="Address" value={address} />}
          <ErrorBlock error={errors[1]} onRetry={handleConnect} />
        </StepCard>
      )}

      {step === 2 && (
        <StepCard n={2} busy={busy} title="Prove you are a person"
          why="One World ID proof, so a profile belongs to one human. No personal data leaves your device — only a nullifier, which cannot be traced back to you.">
          <button class="btn" onClick={openWorldWidget} disabled={busy || worldOpen}>
            Verify with World ID
          </button>
          {rpContext && (
            <IDKitRequestWidget
              open={worldOpen}
              onOpenChange={setWorldOpen}
              app_id={CONFIG.worldAppId as `app_${string}`}
              action={CONFIG.worldAction}
              rp_context={rpContext}
              environment="staging"
              allow_legacy_proofs={true}
              preset={orbLegacy({ signal: address ?? undefined })}
              onSuccess={handleWorldSuccess}
              onError={handleWorldError}
            />
          )}
          {attestation && <Artifact label="Attestation" value={attestation} />}
          <ErrorBlock error={errors[2]} onRetry={openWorldWidget} />
        </StepCard>
      )}

      {step === 3 && (
        <StepCard n={3} busy={busy} title="Describe how you read"
          why="These choices are what the AI adapts every page to. They are encrypted before they leave this page.">
          <ProfileForm
            profile={profile}
            domainsInput={domainsInput}
            onProfileChange={setProfile}
            onDomainsChange={setDomainsInput}
            onSubmit={handleProfileNext}
            busy={busy}
          />
          <ErrorBlock error={errors[3]} onRetry={null} />
        </StepCard>
      )}

      {step === 4 && (
        <StepCard n={4} busy={busy} title="Encrypt and upload"
          why={<>Your wallet signs a fixed message; that signature derives an AES-GCM key that never leaves this page. Only the ciphertext goes to 0G Storage. MetaMask will switch to 0G Galileo (chain {CONFIG.zerogChainId}) first.</>}>
          <button class="btn" onClick={handleEncryptUpload} disabled={busy}>
            {busy ? 'Working…' : 'Encrypt & upload'}
          </button>
          {profileUri && <Artifact label="0G root hash" value={profileUri} />}
          <ErrorBlock error={errors[4]} onRetry={handleEncryptUpload} />
        </StepCard>
      )}

      {step === 5 && !(humanTxHash && profileTxHash) && (
        <StepCard n={5} busy={busy} title="Write it to ENS"
          why={<>Two <code>setText</code> records on {CONFIG.ensName}, back on Sepolia: the attestation and the pointer. Both are public; neither reveals the profile.</>}>
          <button class="btn" onClick={handleWriteEns} disabled={busy}>
            {busy ? 'Working…' : 'Write ENS records'}
          </button>
          {humanTxHash && <Artifact label="Human tx" value={humanTxHash} href={`https://sepolia.etherscan.io/tx/${humanTxHash}`} />}
          {profileTxHash && <Artifact label="Profile tx" value={profileTxHash} href={`https://sepolia.etherscan.io/tx/${profileTxHash}`} />}
          <ErrorBlock error={errors[5]} onRetry={handleWriteEns} />
        </StepCard>
      )}

      {step === 5 && humanTxHash && profileTxHash && (
        <Summary
          ensName={CONFIG.ensName}
          recordKeys={CONFIG.recordKeys}
          attestation={attestation}
          profileUri={profileUri}
          humanTxHash={humanTxHash}
          profileTxHash={profileTxHash}
        />
      )}

      <LogPanel lines={log} />
    </>
  );
```

`ErrorBlock`, `ProfileForm` and `Summary` do not exist yet. To keep this task independently runnable, add these three temporary stubs to `demo/onboarding-ui.tsx` and export them; Tasks 4, 5 and 6 replace each one in turn.

```tsx
// --- replaced in Task 4 ---
export function ErrorBlock({ error }: { error: string | null; onRetry: (() => void) | null }) {
  if (!error) return null;
  return <p class="error__summary" role="alert">Error: {error}</p>;
}

// --- replaced in Task 5 ---
export function ProfileForm(_props: Record<string, unknown>) {
  return <p>Profile form — replaced in Task 5.</p>;
}

// --- replaced in Task 6 ---
export function Summary(_props: Record<string, unknown>) {
  return <p class="summary__done">Onboarding complete.</p>;
}
```

Import all three in `demo/onboarding.tsx` alongside the other components. The `errors` state stays exactly as it is (`Record<StepNum, string | null>`) — Task 4 changes what `ErrorBlock` does with a message, not how it is stored.

- [ ] **Step 4: Rebuild and verify**

Run:

```bash
node scripts/build-onboarding.mjs
node scripts/preview-onboarding.mjs
```

Expected: the build succeeds; the harness writes `01-step1-connect.png` and `02-step2-verify.png`, then fails at the step-3 selector because `ProfileForm` is still a stub — that is expected until Task 5. Open the two PNGs and confirm: styled masthead with the ENS badge and a "Sepolia" network badge, the five-item stepper with step 1 marked current, a single card, and a closed "Technical log" disclosure showing a line count.

- [ ] **Step 5: Confirm the unit suite still passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo/onboarding-ui.tsx demo/onboarding.tsx demo/onboarding.js demo/assets
git commit -m "feat(onboarding): stepper, card e artefatti on-chain per gli step 1-2-4-5"
```

---

### Task 4: Preflight strip and actionable errors

**Files:**
- Modify: `demo/onboarding-ui.tsx`
- Modify: `demo/onboarding.tsx`

**Interfaces:**
- Consumes: `preflightIssues`, `guidanceFor`, `PreflightIssue` from `demo/onboarding-logic.ts`.
- Produces: `PreflightStrip({ issues })`; `ErrorBlock({ error, onRetry })` where `error: unknown` (no longer `string | null`).

- [ ] **Step 1: Replace the `ErrorBlock` stub**

In `demo/onboarding-ui.tsx`, delete the Task-3 `ErrorBlock` stub and add, importing `guidanceFor` from `./onboarding-logic`:

```tsx
/** Errors get three parts: what failed, the raw message (never truncated — it
 *  is often the only diagnostic), and, when the failure is one we recognise,
 *  what to do about it. */
export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry: (() => void) | null }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const guidance = guidanceFor(error);
  return (
    <div class="error" role="alert">
      <p class="error__summary">That step did not complete.</p>
      <p class="error__raw">{message}</p>
      {guidance && <p class="error__guidance">{guidance}</p>}
      {onRetry && <button type="button" class="btn btn--quiet" onClick={onRetry}>Try again</button>}
    </div>
  );
}
```

- [ ] **Step 2: Add the preflight strip**

Add to `demo/onboarding-ui.tsx`, importing the `PreflightIssue` type:

```tsx
/** Warns, never blocks: the point is to surface a broken setup before a wallet
 *  is connected, not to decide the run is impossible. */
export function PreflightStrip({ issues }: { issues: PreflightIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div class="preflight" role="status">
      <p class="preflight__title">
        {issues.length === 1 ? 'One thing needs attention' : `${issues.length} things need attention`}
      </p>
      <ul class="preflight__list">
        {issues.map(i => <li key={i.id}>{i.message}</li>)}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Run preflight on mount in `onboarding.tsx`**

Add to the imports:

```tsx
import { preflightIssues, type PreflightIssue } from './onboarding-logic';
import { PreflightStrip } from './onboarding-ui';
```

Add the state and effect inside `App()`:

```tsx
const [preflight, setPreflight] = useState<PreflightIssue[]>([]);

// Probes the setup once, before anything is clicked. The signer check is a
// bare OPTIONS: scripts/onboarding-server.mjs answers it 204 without signing
// anything, so this costs a round trip and has no side effects — whereas a
// POST would mint an rp_context nobody uses.
useEffect(() => {
  let cancelled = false;
  (async () => {
    let rpContextOk = false;
    try {
      const res = await fetch('/rp-context', { method: 'OPTIONS' });
      rpContextOk = res.status === 204;
    } catch {
      rpContextOk = false;
    }
    if (cancelled) return;
    setPreflight(preflightIssues({
      hasEthereum: Boolean((window as any).ethereum),
      rpContextOk,
      ensName: CONFIG.ensName,
      worldAppId: CONFIG.worldAppId,
      worldAction: CONFIG.worldAction
    }));
  })();
  return () => { cancelled = true; };
}, []);
```

Render it immediately above the `<Stepper>`:

```tsx
<PreflightStrip issues={preflight} />
```

- [ ] **Step 4: Store the error object, not just its message**

Widen the `errors` state so `ErrorBlock` can read a code. In `App()`, change the declaration to:

```tsx
const [errors, setErrors] = useState<Record<StepNum, unknown>>({ 1: null, 2: null, 3: null, 4: null, 5: null });
```

and the setter to:

```tsx
function setError(n: StepNum, error: unknown): void {
  setErrors(e => ({ ...e, [n]: error }));
}
```

`logError` currently returns the message string and every handler passes that to `setError`. Change `logError` to return the error itself, leaving its logging behaviour identical:

```tsx
function logError(context: string, err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err);
  appendLog(`ERROR (${context}): ${message}`);
  return err;
}
```

No call site changes: every handler already does `setError(n, logError(...))`. The one exception is `handleProfileNext`, which passes a literal string — leave it, `ErrorBlock` renders a string fine.

- [ ] **Step 5: Rebuild and verify both states**

Run:

```bash
node scripts/build-onboarding.mjs
node scripts/preview-onboarding.mjs
```

Expected: `01-step1-connect.png` shows **no** preflight strip — the harness stubs `window.ethereum`, answers `OPTIONS /rp-context` with 204, and the bundle carries a filled-in `CONFIG`.

Then verify the warning path renders, by starting a server with no `/rp-context` route:

```bash
npx serve demo -l 8099   # or any generic static server
```

Open `http://localhost:8099/onboarding.html`. Expected: an amber strip above the stepper saying step 2 will fail and naming `scripts/onboarding-server.mjs`.

- [ ] **Step 6: Confirm the unit suite still passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add demo/onboarding-ui.tsx demo/onboarding.tsx demo/onboarding.js demo/assets
git commit -m "feat(onboarding): preflight all'avvio ed errori con rimedio"
```

---

### Task 5: The profile form

**Files:**
- Modify: `demo/onboarding-ui.tsx`
- Modify: `demo/onboarding.tsx`

**Interfaces:**
- Consumes: `parseDomains`, `formatDomains` from `demo/onboarding-logic.ts`; `profileToTheme`, `themeToCssVars` from `../src/core/theme`; `PersonaProfile` from `../src/core/types`.
- Produces: `ProfileForm({ profile, domainsInput, onProfileChange, onDomainsChange, onSubmit, busy })`.

- [ ] **Step 1: Add the sub-components**

In `demo/onboarding-ui.tsx`, add these imports:

```tsx
import { profileToTheme, themeToCssVars } from '../src/core/theme';
import type { PersonaProfile } from '../src/core/types';
import { parseDomains, formatDomains } from './onboarding-logic';
```

and these components:

```tsx
export function ChoiceGroup<T extends string>({ legend, value, options, onChange }: {
  legend: string;
  value: T;
  options: { value: T; name: string; effect: string }[];
  onChange: (value: T) => void;
}) {
  const group = `choice-${legend.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <fieldset class="choices">
      <legend class="choices__legend">{legend}</legend>
      {options.map(o => (
        <label key={o.value} class="choice">
          <input
            type="radio"
            name={group}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span class="choice__text">
            <span class="choice__name">{o.name}</span>
            <span class="choice__effect">{o.effect}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function Toggle({ checked, name, effect, onChange }: {
  checked: boolean;
  name: string;
  effect: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label class="choice">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="choice__text">
        <span class="choice__name">{name}</span>
        <span class="choice__effect">{effect}</span>
      </span>
    </label>
  );
}

/** Chips over a comma-separated string. The string stays the source of truth
 *  so handleProfileNext's split(',') parse remains the single authority on
 *  what gets stored. */
export function DomainChips({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState('');
  const chips = parseDomains(value);

  function commit(raw: string): void {
    const next = parseDomains(raw);
    if (next.length === 0) return;
    onChange(formatDomains([...chips, ...next.filter(c => !chips.includes(c))]));
    setDraft('');
  }

  return (
    <div class="chips">
      {chips.map(c => (
        <span key={c} class="chip">
          {c}
          <button
            type="button"
            class="chip__remove"
            aria-label={`Remove ${c}`}
            onClick={() => onChange(formatDomains(chips.filter(x => x !== c)))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        class="chips__input"
        value={draft}
        placeholder={chips.length === 0 ? 'finance, medicine' : ''}
        aria-label="Add an expertise domain"
        onInput={e => {
          const v = (e.currentTarget as HTMLInputElement).value;
          if (v.includes(',')) commit(v); else setDraft(v);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
          if (e.key === 'Backspace' && draft === '' && chips.length > 0) {
            onChange(formatDomains(chips.slice(0, -1)));
          }
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}

/** Applies the REAL profile->theme mapping from src/core/theme.ts, so what
 *  this shows is what the extension will actually do — not an illustration
 *  of it. */
export function ProfilePreview({ profile }: { profile: PersonaProfile }) {
  const vars = themeToCssVars(profileToTheme(profile));
  return (
    <div class="preview">
      <p class="preview__caption">Preview — the real mapping from src/core/theme.ts</p>
      <div class="preview__surface" style={vars}>
        <h4>Genoa's port doubles container traffic</h4>
        <p>The terminal handled 2.4 million containers last year, up from 1.2 million.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace the `ProfileForm` stub**

Delete the Task-3 stub and add:

```tsx
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'it', name: 'Italiano' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' }
];

export function ProfileForm({ profile, domainsInput, onProfileChange, onDomainsChange, onSubmit, busy }: {
  profile: PersonaProfile;
  domainsInput: string;
  onProfileChange: (profile: PersonaProfile) => void;
  onDomainsChange: (value: string) => void;
  onSubmit: (e: Event) => void;
  busy: boolean;
}) {
  const known = LANGUAGES.some(l => l.code === profile.language);
  const [custom, setCustom] = useState(!known && profile.language !== '');

  function setAccessibility(key: keyof PersonaProfile['accessibility'], value: boolean): void {
    onProfileChange({ ...profile, accessibility: { ...profile.accessibility, [key]: value } });
  }

  return (
    <form onSubmit={onSubmit}>
      <ProfilePreview profile={profile} />

      <div class="field">
        <label class="field__label" for="language-select">Language</label>
        <span class="field__hint">Pages get rewritten into this language.</span>
        <select
          id="language-select"
          class="select"
          value={custom ? 'other' : profile.language}
          onChange={e => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            if (v === 'other') { setCustom(true); return; }
            setCustom(false);
            onProfileChange({ ...profile, language: v });
          }}
        >
          {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name} · {l.code}</option>)}
          <option value="other">Other…</option>
        </select>
        {custom && (
          <input
            class="input"
            style={{ marginTop: 8 }}
            value={profile.language}
            aria-label="BCP-47 language tag"
            placeholder="BCP-47 tag, e.g. nl-BE"
            onInput={e => onProfileChange({ ...profile, language: (e.currentTarget as HTMLInputElement).value })}
          />
        )}
      </div>

      <ChoiceGroup
        legend="Reading level"
        value={profile.readingLevel}
        onChange={v => onProfileChange({ ...profile, readingLevel: v })}
        options={[
          { value: 'simple', name: 'Simple', effect: 'Short sentences, everyday words, jargon explained.' },
          { value: 'standard', name: 'Standard', effect: 'Left roughly as written.' },
          { value: 'expert', name: 'Expert', effect: 'Keeps technical terms and detail, drops the explanations.' }
        ]}
      />

      <ChoiceGroup
        legend="Tone"
        value={profile.tone}
        onChange={v => onProfileChange({ ...profile, tone: v })}
        options={[
          { value: 'plain', name: 'Plain', effect: 'Direct and unadorned.' },
          { value: 'neutral', name: 'Neutral', effect: 'Matches the source.' },
          { value: 'technical', name: 'Technical', effect: 'Precise, assumes domain fluency.' }
        ]}
      />

      <fieldset class="choices">
        <legend class="choices__legend">Accessibility</legend>
        <Toggle
          checked={profile.accessibility.dyslexiaFriendly}
          name="Dyslexia-friendly type"
          effect="Wider letterforms and 1.8 line spacing."
          onChange={v => setAccessibility('dyslexiaFriendly', v)}
        />
        <Toggle
          checked={profile.accessibility.highContrast}
          name="High contrast"
          effect="Pure black on white."
          onChange={v => setAccessibility('highContrast', v)}
        />
        <Toggle
          checked={profile.accessibility.largeText}
          name="Larger text"
          effect="Scales all text up 35%."
          onChange={v => setAccessibility('largeText', v)}
        />
        <Toggle
          checked={profile.accessibility.reduceClutter}
          name="Less clutter"
          effect="More room between blocks; promos and secondary nav are dropped."
          onChange={v => setAccessibility('reduceClutter', v)}
        />
      </fieldset>

      <div class="field">
        <span class="field__label">Expertise domains</span>
        <span class="field__hint">Subjects you already know well, so they are not over-explained. Optional.</span>
        <DomainChips value={domainsInput} onChange={onDomainsChange} />
      </div>

      <button type="submit" class="btn" disabled={busy}>Continue</button>
    </form>
  );
}
```

- [ ] **Step 3: Delete the now-dead helpers in `onboarding.tsx`**

`updateProfile` and `updateAccessibility` are no longer called — `ProfileForm` takes `onProfileChange` and builds the new profile itself. Delete both. Leave `handleProfileNext` untouched: it still reads `profile` and `domainsInput` from state and its `split(',')` parse is unchanged.

- [ ] **Step 4: Rebuild and verify**

Run:

```bash
node scripts/build-onboarding.mjs
node scripts/preview-onboarding.mjs
```

Expected: the harness now gets past step 3 and writes all five PNGs, exiting with "No console or page errors."

Open `03-step3-profile.png` and `04-step3-preview-adapted.png` and confirm the second differs visibly from the first: with *Larger text* and *Dyslexia-friendly type* checked, the preview surface must render bigger text in a different typeface with looser lines. If the two images are identical, `themeToCssVars` output is not reaching `.preview__surface` — check that the `style` object is being applied.

- [ ] **Step 5: Confirm the unit suite still passes**

Run: `npm test`
Expected: PASS. `tests/core/theme.test.ts` in particular — the wizard now depends on it.

- [ ] **Step 6: Commit**

```bash
git add demo/onboarding-ui.tsx demo/onboarding.tsx demo/onboarding.js demo/assets
git commit -m "feat(onboarding): form del profilo per scelte, non per campi di schema"
```

---

### Task 6: Completion summary

**Files:**
- Modify: `demo/onboarding-ui.tsx`

**Interfaces:**
- Consumes: `Artifact` from the same file.
- Produces: `Summary({ ensName, recordKeys, attestation, profileUri, humanTxHash, profileTxHash })` where `recordKeys: { profile: string; human: string }`.

- [ ] **Step 1: Replace the `Summary` stub**

Delete the Task-3 stub and add:

```tsx
/** The end state, and the thing to put on screen during a demo: both records,
 *  both transactions, and a link to the public ENS page that now serves them.
 *  docs/DEMO-SCRIPT.md opens that page by hand today. */
export function Summary({ ensName, recordKeys, attestation, profileUri, humanTxHash, profileTxHash }: {
  ensName: string;
  recordKeys: { profile: string; human: string };
  attestation: string | null;
  profileUri: string | null;
  humanTxHash: string;
  profileTxHash: string;
}) {
  return (
    <section class="card" data-step="done">
      <p class="summary__done">Profile published to {ensName}.</p>
      <h2 class="card__title">Two public records, no public profile</h2>
      <p class="card__why">
        Anyone can read both records. Neither reveals what is in your profile:
        one is a uniqueness proof, the other a pointer to ciphertext.
      </p>

      {attestation && <Artifact label={recordKeys.human} value={attestation} />}
      {profileUri && <Artifact label={recordKeys.profile} value={profileUri} />}
      <Artifact label="Human tx" value={humanTxHash} href={`https://sepolia.etherscan.io/tx/${humanTxHash}`} />
      <Artifact label="Profile tx" value={profileTxHash} href={`https://sepolia.etherscan.io/tx/${profileTxHash}`} />

      <ul class="summary__links">
        <li>
          <a href={`https://sepolia.app.ens.domains/${ensName}`} target="_blank" rel="noreferrer">
            See both records on the public ENS page
          </a>
        </li>
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Verify the summary renders**

The live path cannot be reached without a wallet, so verify it through the test seam. Run `node scripts/build-onboarding.mjs`, start `node scripts/onboarding-server.mjs`, open the page, and in the browser console run:

```js
__ensightGoToStep(5)
```

Expected: step 5's card, because no transaction hashes exist yet. This confirms the `humanTxHash && profileTxHash` guard added in Task 3 works — the summary must not appear before both transactions land.

- [ ] **Step 3: Confirm the unit suite still passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add demo/onboarding-ui.tsx demo/onboarding.js demo/assets
git commit -m "feat(onboarding): schermata finale con entrambi i record e la pagina ENS"
```

---

### Task 7: Full verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/DEMO-SCRIPT.md`

- [ ] **Step 1: Run the unit suite**

Run: `npm test`
Expected: PASS. Record the exact test count in the commit message.

- [ ] **Step 2: Run the end-to-end suite**

Run: `npm run e2e`
Expected: PASS. The guard at `scripts/e2e.mjs:254` checks the popup's "Configura profilo" button against `CONFIG.onboardingUrl`, which this work does not change — a failure there means something in the extension build regressed and must be investigated, not worked around.

- [ ] **Step 3: Rebuild and re-shoot**

Run:

```bash
node scripts/build-onboarding.mjs
node scripts/preview-onboarding.mjs
```

Expected: five PNGs and "No console or page errors." A non-zero exit means a runtime error is reaching the console — fix it before continuing.

- [ ] **Step 4: Check contrast and keyboard access by hand**

With `node scripts/onboarding-server.mjs` running, open the page and confirm:

- Tab reaches, in order: every stepper button that is enabled, the primary button, and in step 3 every radio, checkbox, the select, the chip field and the submit button. Each shows a visible focus ring.
- The "Technical log" and "Local setup" disclosures open with Enter or Space.
- Nothing on the page is the old `#0f0`-on-`#111` combination.

- [ ] **Step 5: Update the README architecture block**

In `README.md`, replace the `demo/` line for the onboarding wizard with three lines listing the new files. The current line reads:

```
  onboarding.html, onboarding.tsx          # localhost onboarding wizard: connect -> World ID -> form -> encrypt -> 0G -> ENS
```

Replace it with:

```
  onboarding.html, onboarding.tsx          # localhost onboarding wizard: connect -> World ID -> form -> encrypt -> 0G -> ENS
  onboarding-ui.tsx, onboarding.css        # its presentation layer (CSS is linked from the HTML, never imported)
  onboarding-logic.ts                      # its pure helpers — chain labels, error guidance, preflight (unit-tested)
```

In the same file's `scripts/` block, add after the `build-onboarding.mjs` line:

```
  preview-onboarding.mjs        # renders the wizard in Chromium with a stubbed wallet and screenshots each step
```

- [ ] **Step 6: Update the demo script**

In `docs/DEMO-SCRIPT.md`, step 4 currently requires a second browser tab on `sepolia.app.ens.domains/reboleira.eth`. Add this note to that step:

```markdown
> Since the onboarding redesign, the wizard's own completion screen lists both
> records with their keys, both Etherscan links, and a link straight to the
> public ENS page — so if you have just run step 5 live, you can show it from
> there instead of switching tabs.
```

- [ ] **Step 7: Commit**

```bash
git add README.md docs/DEMO-SCRIPT.md
git commit -m "docs: indicizza i nuovi file dell'onboarding e la schermata finale"
```

- [ ] **Step 8: Report what was and was not verified**

State plainly, with the command output as evidence: the unit suite result, the e2e result, the build result, and the preview harness result. Then state explicitly that the five live steps — MetaMask connection, World ID verification via the simulator, the 0G Storage upload, and both Sepolia transactions — were **not** run, because they need a real wallet, testnet funds and the World ID staging app. Leave them as a manual pass for the user, pointing at `docs/RUNBOOK.md` §2.4.
