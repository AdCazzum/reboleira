# ENSight

**Generative UI, personalized per person, via ENS.**

ENSight is a Chrome extension (Manifest V3) that uses generative UI to **regenerate the interface of any website tailored to the individual**, based on an identity-and-preferences profile registered in **ENS**.

Same page, different people, different interfaces: someone who needs accessibility (dyslexia, low vision, reduced cognitive load) and someone with content preferences (language, expertise level, tone) see the same information rendered in the way most usable for them. One profile covers both accessibility and preferences, and the AI decides what to apply page by page. The transformation is a **full generative re-layout** — the AI regenerates the interface, it doesn't just re-skin it.

> Working name; built for ETH Global Lisbon 2026.

## How it works

Three layers, each backed by a sponsor technology with a load-bearing role:

- **Chrome extension (the client)** — a content script extracts a semantic **ContentGraph** from the page (headings, text, links, images, forms, actions), keeping a reference to each block's original DOM node. A rendering runtime draws the regenerated UI in an isolated shadow-DOM overlay, with a toggle between original and adapted.
- **Identity & profile** — [**ENS**](https://ens.domains) text records hold a **pointer** to the profile plus a human-verification flag (public but harmless). The rich profile itself is **encrypted and stored on [0G](https://0g.ai) Storage**. Human uniqueness ("one person → one profile") is attested via [**World ID**](https://world.org).
- **Generative UI engine** — a constrained LLM on **0G Compute (TEE-sealed)** turns `ContentGraph + decrypted profile` into a structured **UISpec**. The sensitive profile never leaves a private environment (the browser or the sealed TEE).

### The safety guarantee (no hallucinated navigation)

The AI may **rewrite text** (simplify, translate, change reading level) but **links and actions always come from real `refId`s of the DOM** — never invented URLs. Validation **rejects any `refId`/`sourceRef`/`hidden` id that is not a real block in the ContentGraph**. A regenerated button triggers the *actual* page action, wired back to the original node at click time.

See the full design in [`docs/superpowers/specs/2026-07-24-ensight-generative-ui-design.md`](docs/superpowers/specs/2026-07-24-ensight-generative-ui-design.md) and the implementation plan in [`docs/superpowers/plans/2026-07-24-ensight.md`](docs/superpowers/plans/2026-07-24-ensight.md).

## Architecture

```
src/
  core/                     # pure logic — unit-tested (TDD)
    types.ts                # Block, ContentGraph, PersonaProfile, UITheme, UISpec
    content-extractor.ts    # DOM -> ContentGraph (tags data-ensight-id)
    uispec-schema.ts        # zod schema for UISpec
    uispec-validate.ts      # schema + refId integrity validation
    theme.ts                # PersonaProfile -> UITheme -> CSS vars
    renderer.ts             # UISpec -> shadow-DOM, rewires actions to real nodes
    prompt.ts               # ContentGraph + profile -> LLM system/user messages
    crypto.ts                # wallet signature -> AES-GCM key derivation, encrypt/decrypt
  services/                 # live sponsor-SDK adapters, each behind a small interface
    ens.ts                  # read/write the ENS text-record pointer + human attestation
    zerog-storage.ts        # StorageBackend — encrypted profile put/get on 0G Storage
    zerog-compute.ts        # Broker — TEE inference on 0G Compute -> UISpec
    world-id.ts             # World ID proof -> `world:<nullifier>` attestation string
  content/
    adapt.ts                     # extract -> validate -> render pipeline
    content-script.ts            # orchestrator: live ENS/0G/Compute path with fixture fallback, toggle
    content-script-helpers.ts    # withFallback() — try live, fall back on any error
    bridge.ts                    # ISOLATED-world side of the postMessage RPC to injected.ts
    injected.ts                  # MAIN-world script: the only place that talks to window.ethereum
  background/
    service-worker.ts       # MV3 background service worker
  ui/popup/
    index.html, popup.tsx   # toolbar popup: adapt toggle, persona selector, profile status
  config.ts                 # CONFIG — chain ids, RPC URLs, ENS name, World app id, record keys
demo/
  page-a-news.html, page-b-product.html   # controlled mock pages
  personas/persona-a.json, persona-b.json # two example profiles
  fixtures/uispec-<page>-<persona>.json    # pre-computed UISpecs (offline fallback)
  onboarding.html, onboarding.tsx          # localhost onboarding wizard: connect -> World ID -> form -> encrypt -> 0G -> ENS
  onboarding-ui.tsx, onboarding.css        # its presentation layer (CSS is linked from the HTML, never imported)
  onboarding-logic.ts                      # its pure helpers — chain labels, error guidance, preflight (unit-tested)
  wallet-test.html, wallet-test.ts         # standalone MetaMask-bridge harness
scripts/
  onboarding-server.mjs         # serves demo/ + signs the World ID rp_context (RP key never reaches the browser)
  build-onboarding.mjs, build-wallet-test.mjs  # bundlers for the two localhost harnesses above
  preview-onboarding.mjs        # renders the wizard in Chromium with a stubbed wallet and screenshots each step
  setup-ledger.ts                # one-time 0G Compute ledger funding
  try-inference.ts, try-storage.ts, try-ens.ts  # live smoke tests, one per sponsor SDK
  dump-graph.ts                  # prints a mock page's real refIds (for re-authoring fixtures)
```

## Status

Both paths below are built and have been **live-verified on testnets**:

- **Offline demo** (Tasks 1–8) — the full `extract → validate → render → toggle` pipeline over two mock pages and two personas, via committed fixtures. No network, wallet, or tokens required. This is the reliable, always-works demo path.
- **Live path** — also verified live, end to end: **ENS** read/write of the profile pointer and a human-attestation text record on Sepolia (demoed against `reboleira.eth`); an encrypted profile round-trip on **0G Storage**; a TEE-sealed **0G Compute** call generating a real UISpec; the **wallet bridge** (MetaMask, content-script ↔ injected MAIN-world script); and **World ID 4.0** onboarding via `idkit` v4 (`IDKitRequestWidget` + a signed `rp_context`). Because idkit's `signRequest` only runs under Node, the `rp_context` is signed by a small local server (`scripts/onboarding-server.mjs`) using a non-`VITE_`-prefixed key, so the RP signing key never enters the browser bundle. Runs against World ID staging + the simulator — no physical Orb needed.

**Honest caveat, kept on purpose:** the content script's live profile path reads the ENS pointer live, but in-browser 0G *download* isn't wired up — the 0G Storage SDK's `get()` is Node-only (it shells out to a file-based `Indexer.download()`). So today the content script's profile resolves via the static/fixture fallback in the browser, while the standalone onboarding wizard (a Node-served localhost page) does the real 0G *upload* + ENS *write*. Either way, `withFallback` guarantees the layout always renders: a live-path failure anywhere (no pointer published yet, RPC hiccup, signature declined, network down) drops straight to the pre-computed fixtures, never a blank page.

Phase 2 — a behavioral-adaptation loop where the UI learns from interaction over time — is explicitly out of scope for this build; see the closing note in [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md).

## Tech stack

TypeScript · Vite + [`@crxjs/vite-plugin`](https://crxjs.dev) (MV3) · Preact · Vitest + jsdom · ethers v6 · zod · [`@0gfoundation/0g-storage-ts-sdk`](https://www.npmjs.com/package/@0gfoundation/0g-storage-ts-sdk) + [`@0gfoundation/0g-compute-ts-sdk`](https://www.npmjs.com/package/@0gfoundation/0g-compute-ts-sdk) · `@worldcoin/idkit` v4 (World ID 4.0)

## Getting started

Requires **Node ≥ 20.19** (a `.nvmrc` pins 22.20.0).

```bash
nvm use            # or: nvm install 22.20.0
npm install
npm test           # run the unit + integration suite (Vitest)
npm run build      # produce the unpacked extension in dist/
npm run e2e        # drive the built extension in a real Chromium (see docs/E2E.md)
```

Then load it in Chrome: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the generated `dist/` folder. Open one of the `demo/` pages and use the toggle to see the adapted interface.

For local development:

```bash
npm run dev        # Vite dev server with HMR
```

### Full live setup

The extension-only steps above are enough for the offline demo. To exercise the live ENS/0G/World ID path (testnet tokens, a wallet, a registered ENS name, a World ID staging app) follow [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — the reproducible, zero-budget procedure for the whole thing, split into a token/identity-acquisition day and a build/run day.

To run the onboarding wizard that writes a real profile (connect → World ID verify → form → encrypt → 0G upload → ENS write), start its local server — it both serves the wizard page and signs the World ID `rp_context` — and open the page it prints:

```bash
node scripts/onboarding-server.mjs
# -> http://localhost:8080/onboarding.html
```

## Zero-budget by design

The project runs entirely on **testnets and local tooling** — no paid APIs:

| Component | Cost | How |
|---|---|---|
| Chrome extension | €0 | Loaded unpacked in dev |
| ENS | €0 | Sepolia testnet + faucet ETH |
| 0G Storage + Compute | €0 | 0G testnet (Galileo, chain id `16602`) |
| World ID | €0 | Developer Portal + IDKit, staging + simulator |
| Generative UI | €0 | 0G Compute testnet; fallback: pre-computed fixtures |

Secrets live in a git-ignored `.env` (see `.env.example`); the sensitive profile is encrypted before it ever leaves the client, and the World ID RP signing key lives in a non-`VITE_` variable so it is never bundled into client-side code.

## Testing

- **Unit** — content extractor, UISpec validator (rejects invented/malformed refIds), UISpec normalizer (reconciles a small model's vocabulary drift without ever touching refIds), theme mapping, renderer (a generated action triggers the real DOM node).
- **Integration** — the full offline pipeline over the mock pages; every fixture is validated against the live-extracted ContentGraph.
- **End-to-end** — `npm run e2e` loads the built extension into a real Chromium and drives the service worker, content script, MAIN-world wallet bridge, toggle, both personas and the popup. Offline and deterministic: it builds with `--mode e2e` so every live path fails instantly, which also exercises the fallback on every run. The live chains (World ID, 0G, ENS) are verified by hand — see [docs/E2E.md](docs/E2E.md).
- **Fallback** — a pre-computed UISpec is cached for each (page, persona) so the demo never depends on live inference. Which path won is logged to the page console, so a silent fallback can never masquerade as a live run.
