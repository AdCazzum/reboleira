# ENSight — demo runbook (zero budget)

Reproducible procedure to set up and run the ENSight demo end to end on
testnets only. **Total cost: €0.** Everything runs on Sepolia, the 0G Galileo
testnet and World ID *staging*.

Split over two days because the token/faucet steps are the ones that can
block you: **Day 1 is acquisition** (names, faucets, app registration — do it
the day before), **Day 2 is the demo itself** (build, run, present).

### Status legend

Not every path is wired yet. Each step is marked:

| Mark | Meaning |
|---|---|
| ✅ | Works today on `master` |
| ⏳ | Needs a task that is not built yet — a working manual equivalent is given |

The **offline demo is always available and needs none of this setup** — see
[Plan Z: the offline demo](#plan-z-the-offline-demo-always-works). Read that
section first: it is the safety net the whole runbook falls back to.

### What is on `master` right now

Several finished pieces sit on branches that have not been merged. **Check
this before you build** — it decides which steps below actually work.

| Piece | Where | Needed for |
|---|---|---|
| Extract → validate → render → toggle, fixtures | `master` | the whole offline demo |
| 0G Storage + 0G Compute adapters, all `scripts/` | `master` | [2.2](#22-verify-each-live-path-before-the-demo-) |
| ENS read/write + `scripts/try-ens.ts` | `ensight/task-13-ens` | ENS steps |
| World ID `attestationFromProof` | `ensight/task-14-world-id` | onboarding |
| Popup UI (toggle + persona selector) | `ensight/task-15-popup` | [2.5](#25-show-the-two-personas-) |
| `withFallback` helper | `ensight/task-16a-fallback` | onboarding |
| Onboarding wizard (Task 16) | **not built** | [2.4](#24-run-the-onboarding-) |

To demo the fullest version available today, merge the four branches into a
throwaway integration branch and build from that. If you only want the safe
offline demo, `master` alone is enough.

---

## 0. Prerequisites ✅

- **Node ≥ 20.19** — the repo pins 22.20.0 in `.nvmrc`.
- **Google Chrome** (or any Chromium with MV3 support).
- **MetaMask** installed in that Chrome profile.
- A **throwaway wallet**. You will export its private key into a shell for the
  helper scripts — never use a wallet holding real funds, and never paste the
  key into a file.

```bash
nvm use            # or: nvm install 22.20.0
npm install
npm test           # must be green before you go any further
```

The helper scripts run under [`tsx`](https://tsx.is) via `npx tsx …`. `tsx` is
deliberately *not* a dependency; `npx` fetches it on first use, so run one
script early (Day 1) rather than discovering the download at demo time.

---

## Day 1 — acquire tokens and identities

Do this **the day before**. Faucets rate-limit, and the 0G ledger needs more
OG than a single faucet drip gives you.

### 1.1 Sepolia ETH ✅

Needed for: registering the ENS name + two `setText` transactions.
Budget **~0.05 Sepolia ETH**; the ENS registration is the expensive part.

No-KYC options:

- <https://sepolia-faucet.pk910.de> — proof-of-work faucet, no account needed.
- <https://cloud.google.com/application/web3/faucet/ethereum/sepolia> — Google
  Cloud Web3 faucet.

Faucet availability changes; if both are dry, ask at the ETHGlobal help desk —
someone always has spare Sepolia ETH.

### 1.2 A Sepolia ENS name ✅

1. Go to <https://sepolia.app.ens.domains>, connect the throwaway wallet
   (MetaMask must be on the **Sepolia** network).
2. Register a name you can spell out loud on stage — you will read it to the
   audience. Pick a **long, unfashionable** one: short names cost more.
3. Confirm the name resolves and that **your wallet is the manager**
   (the "Manager" role, not just the owner) — `setText` is authorised against
   the resolver, so a name you own but do not manage will fail to write.

Record it as `VITE_ENS_NAME` / `ENS_NAME`.

### 1.3 World ID staging app ✅

1. Go to <https://developer.worldcoin.org> and sign in.
2. Create an app in **Staging** mode (staging accepts the simulator, so you do
   not need a physical Orb verification to demo).
3. Inside the app create an **Incognito Action**, e.g. `verify-human`.
4. Copy the **app id** (`app_staging_…`) and the **action id**.

Record them as `VITE_WORLD_APP_ID` / `VITE_WORLD_ACTION`.

### 1.4 0G testnet OG — the one that bites ⚠️ ✅

Needed for: 0G Storage uploads (gas + storage fee) **and** the 0G Compute
ledger. Budget **≥ 4 OG**, and note the shape of the cost:

| What | Cost | Note |
|---|---|---|
| 0G Compute master ledger — creation | **~3 OG minimum** | `LedgerProcessor.MIN_LEDGER_BALANCE_OG` in the SDK. One-time, per wallet. |
| 0G Compute provider sub-account | ~1 OG | Created automatically on the first inference call to a given provider. |
| Each inference call | negligible | Drawn from the ledger. |
| 0G Storage upload | gas + storage fee | Measured at ~6.1e10 neuron for a 305-byte encrypted profile — negligible. **No ledger needed**; paid straight from the wallet. |

So: **the ledger alone is a ~3 OG wall.** The public faucet drips far less
than that per day.

1. Public faucet: <https://faucet.0g.ai> — requires linking an X account, and
   gives a small amount per day. Start claiming on Day 1, not Day 2.
2. **Then ask for a top-up.** At an ETHGlobal event, go to the 0G booth or
   their Discord and ask for testnet OG for a hackathon project — this is
   normal and they expect it. This is the reliable path to 4+ OG.

Sanity-check the balance before continuing:

```bash
# any Sepolia/0G-capable tool works; e.g. with cast, or just check in MetaMask
# after adding the 0G Galileo network: chainId 16602, RPC https://evmrpc-testnet.0g.ai
```

### 1.5 Create the 0G Compute ledger ✅

One-time, per wallet. Without it every inference call fails with
*"Account does not exist. Please create an account first."*

```bash
PRIVATE_KEY=0x... AMOUNT=4 npx tsx scripts/setup-ledger.ts
```

The script is safe to re-run: if a ledger already exists it prints it and
exits without calling `addLedger` again. It does **not** top up — to add funds
to an existing ledger use `broker.ledger.depositFund(<amountInOG>)` (or
`npx 0g-compute-cli deposit --amount <n>`).

On creation it prints the on-chain balance — **verify it matches what you
expect** (`AMOUNT=4` → `4000000000000000000` = 4 OG). `AMOUNT` is passed to the
SDK as a plain number in **OG** units, not neuron/wei; that balance line is
what confirms the assumption held.

### Day 1 done — checklist

- [ ] Sepolia ETH in the wallet (~0.05)
- [ ] Sepolia ENS name registered, wallet is the **manager**
- [ ] World ID staging app id + action id copied
- [ ] ≥ 4 OG on 0G Galileo
- [ ] 0G Compute ledger created, balance verified
- [ ] `npm test` green, `npx tsx` primed

---

## Day 2 — build and run

### 2.1 Fill in `.env` ✅

```bash
cp .env.example .env
```

Fill the five `VITE_*` values from Day 1. `.env` is git-ignored.

> **Gotcha:** these are inlined at **build** time. Changing `.env` after
> building does nothing until you re-run `npm run build` *and* reload the
> extension in `chrome://extensions`.

The second half of `.env.example` documents the script-only variables
(`PRIVATE_KEY`, `AMOUNT`, …). Those are **not** read from `.env` — export them
inline on the command line, per invocation.

### 2.2 Verify each live path before the demo ✅

Run these once on Day 2, in this order. Each is a standalone smoke test
against the real network — if one fails you have hours, not seconds, to react.

```bash
# 1. 0G Compute — list providers (read-only, free)
PRIVATE_KEY=0x... npx tsx scripts/try-inference.ts

# 2. 0G Compute — real inference (spends from the ledger)
PRIVATE_KEY=0x... PROVIDER_ADDRESS=0xa48f01287233509FD694a22Bf840225062E67836 \
  npx tsx scripts/try-inference.ts

# 3. 0G Storage — encrypted upload + download round-trip (spends gas + fee)
PRIVATE_KEY=0x... npx tsx scripts/try-storage.ts

# 4. ENS — read the pointer, write it, read it back (spends Sepolia ETH)
PRIVATE_KEY=0x... SEPOLIA_RPC=https://... ENS_NAME=yourname.eth \
  npx tsx scripts/try-ens.ts
```

**Provider choice matters.** Run step 1 first and read the list. At the last
verified check the testnet exposed two providers, and only one serves text:

| Provider | Model | Use |
|---|---|---|
| `0xa48f01287233509FD694a22Bf840225062E67836` | `qwen/qwen2.5-omni-7b` | ✅ this one |
| `0x4b2a941929E39Adbea5316dDF2B9Bd8Ff3134389` | `qwen/qwen-image-edit-2511` | ❌ image editing, not usable |

Do not hard-code the address blindly — providers come and go. Step 1 is the
source of truth; the table is a starting point.

> Command (4) needs the `ensight/task-13-ens` branch — `scripts/try-ens.ts` is
> not on `master` yet. It writes
> the text record **directly** with `ethers.Wallet` + `resolver.setText`,
> mirroring what `src/content/injected.ts` does in the browser, because
> `writeProfilePointer()` goes through `callInjected()` and needs a real
> `window` + MetaMask.

Expected results: a schema-valid UISpec printed for (2); an exact round-trip
for (3); the pointer read back identical to what was written for (4).

### 2.3 Build and load the extension ✅

```bash
npm run build      # produces dist/
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the generated `dist/` folder

Serve the mock pages over HTTP — content scripts on `file://` URLs need an
extra permission toggle, so avoid the whole problem:

```bash
python3 -m http.server -d demo 8080
```

Pages: <http://localhost:8080/page-a-news.html> and
<http://localhost:8080/page-b-product.html>.

### 2.4 Run the onboarding ⏳

**Requires Task 16 (onboarding wizard), not built yet.** When it lands, the
flow is: popup → *Configura profilo* → connect wallet → World ID verify →
fill the profile form → sign (derives the AES key) → encrypt + upload to 0G
Storage → write the ENS pointer + attestation. It ends showing a Sepolia
transaction hash.

**Manual equivalent today** — the same on-chain end state, assembled from the
verified scripts:

1. `scripts/try-storage.ts` uploads an encrypted profile and prints its
   **root hash**.
2. `scripts/try-ens.ts` writes that root hash into the
   `app.ensight.profile` text record of your ENS name.

That reproduces steps 4 and 5 of the wizard. Steps 1–3 (connect, World verify,
profile form) have no headless equivalent; for the wallet half you can still
demo `demo/wallet-test.html` (see 2.6).

### 2.5 Show the two personas ⏳

**The popup is built (Task 15) but lives on the `ensight/task-15-popup`
branch** — it is not on `master` yet. Which path you get depends on what you
built from:

**With the Task 15 branch** — click the ENSight toolbar icon:

1. **Adatta questa pagina** — toggles the adapted UI on the active tab.
2. **Persona (dev)** — the selector writes `chrome.storage.local.persona`.
3. **Profilo: trovato / non configurato** — reads
   `chrome.storage.local.profileUri`, which the Task 16 onboarding will write.
4. **Configura profilo** — opens the onboarding tab. Until Task 16 lands this
   is an error page; expected.

> The persona applies to the **next** adaptation — `activePersona()` is read
> when the adapted view is built. Toggle **off**, switch persona, toggle **on**.

**From `master`** the popup is still the placeholder `index.html` with no
script, so the toolbar icon opens an empty panel. Drive the same two controls
from the **service worker console** instead: `chrome://extensions` → the
ENSight card → click **service worker**.

```js
// switch persona
await chrome.storage.local.set({ persona: 'personaB' });   // or 'personaA'

// toggle the adapted UI on the demo tab
const [tab] = await chrome.tabs.query({ url: 'http://localhost:8080/*' });
await chrome.tabs.sendMessage(tab.id, { type: 'ensight:toggle' });
```

The two personas (`demo/personas/`) are deliberately opposite, which is the
whole point of the demo:

| | Persona A | Persona B |
|---|---|---|
| Language | `it` | `en` |
| Reading level | `simple` | `expert` |
| Tone | `plain` | `technical` |
| Dyslexia-friendly | ✅ | ❌ |
| High contrast | ❌ | ✅ |
| Large text | ✅ | ✅ |
| Reduce clutter | ✅ | ❌ |
| Expertise domains | — | `finance`, `crypto` |

**The demo beat:** same URL, same DOM, two radically different interfaces —
and the links and buttons in both still drive the *original* page nodes.

### 2.6 Optional: the wallet harness ✅

A standalone page that exercises the MetaMask bridge without the extension —
useful if you want to show `eth_requestAccounts` / `personal_sign` and the key
derivation in isolation:

```bash
python3 -m http.server -d demo 8080
# then open http://localhost:8080/wallet-test.html
```

Rebuild it after changing `demo/wallet-test.ts`:

```bash
node scripts/build-wallet-test.mjs
```

---

## Plan Z: the offline demo (always works)

**If every network path fails, the demo still runs.** This is not a
degradation story bolted on at the end — it is how `content-script.ts` works
today, and it needs no `.env`, no wallet, no tokens, no internet.

Four UISpecs are pre-computed and committed in `demo/fixtures/`, one per
(page, persona) pair. `fixtureFor(url, persona)` picks one by matching
`page-a` / `page-b` in the URL. Once Task 16 wires the live path, `withFallback`
tries 0G Compute first and drops to these fixtures on *any* error.

### Pre-demo fallback checklist

```bash
npm test           # tests/demo/fixtures.test.ts validates every fixture
                   # against the graph freshly extracted from the mock page
npm run build
```

- [ ] All four fixtures present:
      `demo/fixtures/uispec-{a,b}-persona{A,B}.json`
- [ ] `npm test` green — this is what proves the fixtures' `refId`s still match
      the mock pages. **If you edit a demo page, re-run it**: a stale fixture
      points at block ids that no longer exist and the validator rejects it.
- [ ] `npm run build` succeeds and `dist/` exists
- [ ] Extension loaded unpacked, toggle works on both mock pages
- [ ] Laptop can run the whole thing **in airplane mode** — try it once

If you changed a mock page and need to re-author a fixture, dump the real
block ids first:

```bash
npx tsx scripts/dump-graph.ts demo/page-a-news.html
```

---

## Troubleshooting

Failures we actually hit, and what they mean.

**`does not provide an export named 'C'`** when running a script
The `tsx` esbuild loader mishandles the 0G SDK's ESM chunk (plain Node loads
it fine). Already fixed in `try-inference.ts` / `setup-ledger.ts` via a
`createRequire` loader injected through the `loadSdk` parameter. If you write
a *new* script that touches a 0G SDK, copy that pattern — do not `import` the
SDK directly at the top level.

**`Account does not exist. Please create an account first.`**
The 0G Compute master ledger was never created for this wallet. Run
[1.5](#15-create-the-0g-compute-ledger-).

**Inference succeeds but JSON parsing fails**
The model returned prose or several objects. `buildMessages` already pins the
exact UISpec schema plus a worked example, which fixed this on the 7B model —
but a *different* provider/model may drift again. Fall back to the fixtures
and move on; do not debug prompts live on stage.

**0G Storage download fails right after a successful upload**
Propagation/finality lag. Re-run just the download half with the root hash the
upload printed:

```bash
PRIVATE_KEY=0x... DOWNLOAD_URI=0x0251... npx tsx scripts/try-storage.ts
```

**`setText` reverts**
The wallet is not the ENS **manager** of the name (owning is not enough), or
MetaMask is on the wrong network. ENS here is **Sepolia**, not mainnet and not
0G.

**Chain id confusion**
0G Galileo testnet is **16602**. Some 0G docs and older notes in this repo say
`16601`; `src/config.ts` uses 16602, verified live against
`https://evmrpc-testnet.0g.ai`.

**Changed `.env` and nothing happened**
Re-run `npm run build` and reload the extension. `VITE_*` values are inlined
at build time.

**The popup is empty**
You built from `master`; the popup UI is on the `ensight/task-15-popup`
branch. Either build from that branch or use the service-worker console — see
[2.5](#25-show-the-two-personas-).

**The popup says "Content script non attivo qui"**
`chrome.tabs.sendMessage` rejected because no content script runs on that tab
(`chrome://`, the Web Store, or a `file://` URL without the file-access
permission). Open one of the mock pages over `http://localhost:8080` instead.

**Switched persona but the page looks the same**
The persona is read when the adapted view is built. Toggle off, switch, toggle
back on.

---

## Cost summary

| Component | Cost | Source |
|---|---|---|
| Chrome extension | €0 | loaded unpacked, never published |
| ENS name + text records | €0 | Sepolia + faucet ETH |
| 0G Storage | €0 | Galileo testnet (chainId 16602) |
| 0G Compute (TEE inference) | €0 | Galileo testnet ledger, faucet + booth top-up |
| World ID | €0 | Developer Portal, staging app |
| Fallback inference | €0 | pre-computed fixtures, committed to the repo |
