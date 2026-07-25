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
  core/                 # pure logic — unit-tested (TDD)
    types.ts            # Block, ContentGraph, PersonaProfile, UITheme, UISpec
    content-extractor.ts# DOM -> ContentGraph (tags data-ensight-id)
    uispec-schema.ts    # zod schema for UISpec
    uispec-validate.ts  # schema + refId integrity validation
    theme.ts            # PersonaProfile -> UITheme -> CSS vars
    renderer.ts         # UISpec -> shadow-DOM, rewires actions to real nodes
  content/
    adapt.ts            # extract -> validate -> render pipeline
    content-script.ts   # orchestrator + original/adapted toggle
demo/
  page-a-news.html, page-b-product.html   # controlled mock pages
  personas/persona-a.json, persona-b.json # two example profiles
  fixtures/uispec-<page>-<persona>.json    # pre-computed UISpecs (offline fallback)
```

## Status

This repository currently implements the **offline end-to-end demo** (plan Tasks 1–8): the full `extract → validate → render → toggle` pipeline running entirely offline on controlled mock pages via pre-computed fallback fixtures — no network, wallet, or testnet tokens required.

- ✅ Content extractor, UISpec schema + anti-hallucination validation, theme mapping, shadow-DOM renderer (all TDD).
- ✅ Two mock pages, two personas, four validated fallback fixtures.
- ✅ Content-script orchestration + toggle, with an offline end-to-end integration test.

**Planned / not yet built** (plan Tasks 9–18): AES-GCM profile encryption, 0G Storage/Compute adapters, ENS read/write of the profile pointer, World ID onboarding, wallet bridge, and the popup/onboarding UI. These require testnet tokens, a wallet (MetaMask), and live sponsor SDKs.

## Tech stack

TypeScript · Vite + [`@crxjs/vite-plugin`](https://crxjs.dev) (MV3) · Preact · Vitest + jsdom · ethers v6 · zod · 0G SDKs · `@worldcoin/idkit`

## Getting started

Requires **Node ≥ 20.19** (a `.nvmrc` pins 22.20.0).

```bash
nvm use            # or: nvm install 22.20.0
npm install
npm test           # run the unit + integration suite (Vitest)
npm run build      # produce the unpacked extension in dist/
```

Then load it in Chrome: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the generated `dist/` folder. Open one of the `demo/` pages and use the toggle to see the adapted interface.

For local development:

```bash
npm run dev        # Vite dev server with HMR
```

## Zero-budget by design

The project runs entirely on **testnets and local tooling** — no paid APIs:

| Component | Cost | How |
|---|---|---|
| Chrome extension | €0 | Loaded unpacked in dev |
| ENS | €0 | Sepolia testnet + faucet ETH |
| 0G Storage + Compute | €0 | 0G testnet (Galileo, chain id `16601`) |
| World ID | €0 | Developer Portal + IDKit (staging) |
| Generative UI | €0 | 0G Compute testnet; fallback: pre-computed fixtures + local model |

Secrets live in a git-ignored `.env` (see `.env.example`); the sensitive profile is encrypted before it ever leaves the client.

## Testing

- **Unit** — content extractor, UISpec validator (rejects invented/malformed refIds), theme mapping, renderer (a generated action triggers the real DOM node).
- **Integration** — the full offline pipeline over the mock pages; every fixture is validated against the live-extracted ContentGraph.
- **Fallback** — a pre-computed UISpec is cached for each (page, persona) so the demo never depends on live inference.
