# Onboarding page redesign — design

Redesign of `demo/onboarding.html` + `demo/onboarding.tsx`: the five-step
wizard (connect wallet → World ID → profile → encrypt & upload to 0G → write
ENS) served by `scripts/onboarding-server.mjs`.

The page is currently labelled a dev-only harness, but it is also beat 5 of
`docs/DEMO-SCRIPT.md` and the only thing that publishes a real profile. It is
demo-facing: technically honest, but built to be projected. Copy stays in
English, matching README/RUNBOOK/DEMO-SCRIPT and the hackathon audience.

## What does not change

The live path is verified end to end on testnets. This is a presentation-layer
change only. Byte-for-byte unchanged:

- The bodies of `handleConnect`, `openWorldWidget`, `handleWorldSuccess`,
  `handleWorldError`, `handleEncryptUpload`, `handleWriteEns`, `switchChain`,
  `extractNullifier`, `refreshSigner`
- The `humanTxHash` / `profileTxHash` retry guards in `handleWriteEns` — they
  remain the only thing deciding whether a transaction is re-sent
- Every existing import from `src/` (`CONFIG`, `crypto.ts`, `world-id.ts`,
  `zerog-storage.ts`, `types.ts`) and the `IDKitRequestWidget` props. One
  import is *added*: `profileToTheme` / `themeToCssVars` from
  `src/core/theme.ts`, for the step-3 live preview
- The shape of `PersonaProfile`
- `scripts/build-onboarding.mjs` and `scripts/onboarding-server.mjs`
- `CONFIG.onboardingUrl` — the popup's "Configura profilo" button and the
  regression guard at `scripts/e2e.mjs:254` keep working untouched

The header comment block in `demo/onboarding.tsx` is documentation of hard-won
findings (why `signRequest` cannot run in the browser, why the react→preact
alias is required, why `'nullifier' in item` narrows safely). It is preserved
in full; a short paragraph about the UI layer is appended.

## Files

| File | Change |
|---|---|
| `demo/onboarding.css` | **New.** Hand-written stylesheet, `<link>`ed from the HTML |
| `demo/onboarding-ui.tsx` | **New.** Presentational components |
| `demo/onboarding.html` | Restructured: static header, `<link>`, dev prose moved into a `<details>` |
| `demo/onboarding.tsx` | Presentation swapped for the new components; flow logic unchanged |

### Why the CSS is a separate hand-written file, not an import

`scripts/build-onboarding.mjs` pins `entryFileNames: 'onboarding.js'` for a
single entry. A `import './onboarding.css'` from the `.tsx` would make Vite
emit a *separate* hashed CSS asset into `demo/` that `onboarding.html` never
references — the styles would silently not apply, with a green build. A
hand-written `demo/onboarding.css` linked from the HTML needs no build change
at all, and `scripts/onboarding-server.mjs` already serves `.css` as
`text/css` (`MIME_TYPES`, line 106). `emptyOutDir: false` means the build will
not wipe it.

### Why the components move to their own file

`demo/onboarding.tsx` is 621 lines before this change. Splitting the
presentational components out keeps the flow file focused on the five async
handlers and its header comment. Vite bundles the local import with no build
change; the build input stays `demo/onboarding.tsx`.

## Visual system

Direction: sober, editorial-technical. Every rule below has a reason; the
anti-slop discipline is that nothing is added for decoration.

| Choice | Rule | Reason |
|---|---|---|
| Type | `system-ui` for prose. Monospace **only** for on-chain artifacts: addresses, hashes, tx ids, record keys, the attestation, the 0G root hash | Monospace becomes a semantic signal — "this is a literal value from a chain" — never decoration |
| Scale | 13 / 15 / 17 / 22 / 32 px, line-height 1.55 | One scale, no per-case invented values |
| Colour | Ink `#14161a`, muted `#5c6470`, hairline `#e2e5ea`, surface `#ffffff`, canvas `#f7f8fa`. Semantic: green `#137333` (done), red `#a50e0e` (error) | Those two semantics are the ones already used in `src/ui/popup/popup.tsx`. The primary action is ink-black, like today's active step — no invented brand accent, which is the most reliable way not to drift into gradients |
| Surfaces | One 1px hairline border. No decorative shadows | |
| Motion | Two transitions only, both functional (step change, log disclosure), both inside `prefers-reduced-motion: no-preference` | A project about accessibility that ignores `prefers-reduced-motion` contradicts itself |
| Excluded | Gradients, glassmorphism, emoji as icons, oversized rounded cards, marketing hero, animated blobs | |

Light theme only: the demo is projected in a lit room, and the IDKit modal is
third-party and not ours to restyle. All tokens live as custom properties on
`:root`, so a dark theme stays a small later addition.

### Accessibility (requirement, not polish)

- Stepper is an `<ol>`; the current step carries `aria-current="step"`
- Error blocks are `role="alert"`; the technical log is `aria-live="polite"`
- In-flight steps set `aria-busy`
- `:focus-visible` is styled on every interactive element; `outline: none` is
  never used without a replacement
- Accessibility toggles are real `<input type="checkbox">` elements, styled —
  not `<div>`s with click handlers
- All text meets 4.5:1 contrast. This retires the current
  `#0f0`-on-`#111` log, which does not

## Page structure

Slim sticky header: wordmark · ENS name · network badge · connected address.

Below it: the page title and one honest promise line — *"Your profile is
encrypted in your browser. The plaintext never leaves this device."* — then the
stepper, then a single card in a ~680px column.

Every step has the same anatomy: title → one line on *why* (not on setup) →
control → a result area showing the artifact produced, in monospace, with a
copy button.

Two closed `<details>` at the foot:

- **Technical log** with a line counter. Monospace, dark-on-light, auto-scrolled.
- **Local setup** — the dev prose currently sitting at the top of
  `onboarding.html` (serve over `http://localhost`, use
  `onboarding-server.mjs` not a generic static server, `.env` requirements)
  moves here verbatim in substance. Moved, not deleted: it is the information
  a developer reproducing `docs/RUNBOOK.md` needs.

### Network badge

Reads `eth_chainId` and subscribes to `chainChanged`. Renders `Sepolia`,
`0G Galileo`, or `Chain <hex>` for anything else. Steps 4 and 5 already switch
networks via `switchChain`; the badge makes it legible why MetaMask is
prompting.

### Preflight

Runs on mount. Shows a compact warning strip only when a check fails.

1. `window.ethereum` present → otherwise "MetaMask not detected. Install it and
   reload this page over `http://localhost`."
2. `fetch('/rp-context', { method: 'OPTIONS' })` → the server answers `204`
   **without signing anything** (`handleRpContext`, the `OPTIONS` branch at
   `scripts/onboarding-server.mjs:153`). A side-effect-free health check. A
   404/405/network error means the page is being served by something other
   than `onboarding-server.mjs` and step 2 will fail.
3. `CONFIG.ensName`, `CONFIG.worldAppId`, `CONFIG.worldAction` non-empty →
   otherwise "missing in `.env`; fill it and re-run
   `node scripts/build-onboarding.mjs`" (CONFIG is inlined at build time).

Failing preflight does not block the buttons — it warns. Knowing before
connecting a wallet beats discovering it mid-demo.

### Back navigation

Clicking a completed step in the stepper reopens it read-only, showing the
artifact it produced. It re-runs nothing. Forward movement still happens only
by completing a step, so the transaction retry guards keep sole authority over
re-sends.

### Errors

`ErrorBox` becomes a structured block: a bold one-line summary, the raw
message in monospace (never truncated — it is often the only diagnostic), and
a "what to do" line from a small lookup table:

| Condition | Guidance |
|---|---|
| MetaMask rejection (code `4001`) | "You declined it in MetaMask. Click again when ready." |
| Non-OK HTTP from `/rp-context` | "Start the signing server: `node scripts/onboarding-server.mjs`" |
| Insufficient funds | "This wallet needs testnet OG / Sepolia ETH — see `docs/RUNBOOK.md`" |
| Anything else | No guidance line; summary + raw message only |

A retry button sits in the block, invoking the same handler.

### Completion screen

Once both `humanTxHash` and `profileTxHash` are set, the card becomes a
summary: the ENS name, both record keys with their values
(`app.ensight.human` = attestation, `app.ensight.profile` = 0G root hash),
both Etherscan links, and a link to
`https://sepolia.app.ens.domains/<ensName>`. That last one is beat 4 of
`docs/DEMO-SCRIPT.md`, which currently requires opening a tab by hand.

## Step 3 — the profile form

Today the form exposes the schema: a raw BCP-47 text input, selects whose
options are the literal union values, checkboxes labelled `dyslexiaFriendly`
and `reduceClutter`, and comma-separated domains. It is the only step where a
person makes a real choice, and the one that demonstrates the project's thesis.

- **Language** — a select of common languages showing the code
  (`Italiano · it`), plus "Other…" revealing the free-text input. The stored
  value is still the BCP-47 string; arbitrary tags remain reachable.
- **Reading level** and **Tone** — radio-card groups, each option labelled by
  its *effect* rather than its enum value.
- **Accessibility** — four toggles with human labels and their real
  consequence, taken from `src/core/theme.ts`: *Larger text* → "Scales all text
  up 35%" (`fontScale: 1.35`); *Dyslexia-friendly type* → wider letterforms,
  1.8 line spacing; *High contrast* → pure black on white; *Less clutter* →
  comfortable density, hides promos and secondary nav.
- **Expertise domains** — chip input (Enter or comma commits a chip,
  Backspace on an empty field removes the last). The chip component keeps the
  existing `domainsInput` string as its source of truth, writing chips back
  comma-joined, so `handleProfileNext`'s `split(',').map(trim).filter(Boolean)`
  parse and its validation are untouched.
- **Live preview** — a text fragment that re-renders as choices change,
  produced by passing the in-progress profile through the **real**
  `profileToTheme()` and `themeToCssVars()` from `src/core/theme.ts` and
  applying the returned CSS variables.

The preview is deliberately not an illustration: it is the same production
mapping the extension uses, which makes it both honest and a demonstration of
the thesis inside the page that configures it. `PersonaProfile` is unchanged,
so there is no impact on `crypto.ts`, 0G Storage or the ENS write.

## Verification

Verifiable here:

- `npm test` green (the unit suite does not cover `demo/`, but `theme.ts` is
  now imported by the wizard, so a regression there must not slip)
- `node scripts/build-onboarding.mjs` completes and emits `demo/onboarding.js`
- `npm run e2e` green — the guard at `scripts/e2e.mjs:254` checks the popup's
  onboarding button against `CONFIG.onboardingUrl`, which is unchanged
- Rendering, driven in a headless browser with a stubbed `window.ethereum`:
  shell, stepper, preflight strip, step 3 (including the live preview and
  chip input), the log disclosure and the error block, captured as screenshots

Not verifiable here, left as a manual pass for the user: the five live steps.
They need a real wallet, testnet funds and the World ID simulator.
