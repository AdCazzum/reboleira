# ENSight — live demo script (~3 minutes)

Presenter-facing. Short beats: what to click, what to say. Full setup
procedure is [`docs/RUNBOOK.md`](RUNBOOK.md); this is just the on-stage
sequence, assuming setup already happened.

**Reliability note (read this first):** every beat below except step 5/6 runs
against the committed fixtures if anything on the network hiccups —
`withFallback` tries the live path and drops to a pre-computed UISpec on
*any* error. If Wi-Fi at the venue is bad, the toggle demo (steps 2–4, the
actual money shot) still works. Don't apologize for it, don't even mention it
unless something visibly fails — it just quietly works.

---

## 0. Setup (done before you go on stage)

- Extension built (`npm run build`) and loaded unpacked in Chrome.
- Mock pages served: `python3 -m http.server -d demo 8080`.
- A profile already published on ENS (`reboleira.eth` in this build):
  `app.ensight.profile` points at an encrypted blob on 0G Storage,
  `app.ensight.human` holds a World ID attestation.

Have two browser tabs ready: one on `localhost:8080/page-a-news.html`, one on
`sepolia.app.ens.domains/reboleira.eth` (for step 5).

---

## 1. Raw page (15s)

**Click:** open `http://localhost:8080/page-a-news.html`.

**Say:** "This is a normal news page. No special markup, nothing built for
this demo — it's just HTML." Scroll once so the audience sees it's a real,
boring page.

---

## 2. Persona A — accessibility-first (45s)

**Click:** open the ENSight popup → toggle **Adatta questa pagina**
(persona defaults to Persona A).

**Say while it renders:** "ENSight just extracted the page into a content
graph and regenerated the interface for *this specific person's* profile —
dyslexia-friendly font, large text, simplified language, Italian."

**Point out:** click a link or button in the adapted view. "That's not a
fake link — it's wired back to the real DOM node from the original page.
The AI can rewrite text, but it can never invent navigation. That's
validated, not just prompted."

---

## 3. Persona B — same page, completely different UI (45s — the money shot)

**Click:** toggle off, switch the persona selector to **Persona B**, toggle
back on. (Persona applies on the *next* adaptation — off, switch, on.)

**Say:** "Same URL. Same DOM. I didn't reload, I didn't change the page —
I changed *who's looking at it*." Let the contrast land for a second:
expert reading level, English, high contrast, technical tone, no
accessibility padding.

**Point out:** click a link again. "Still the real page underneath. Two
completely different interfaces, one source of truth."

*(Optional beat if there's time: repeat steps 1–3 on `page-b-product.html`
to show it's not a one-page trick.)*

---

## 4. Under the hood (45s)

**Say, no clicking required (or flip to the ENS tab prepared in setup):**

- "The pointer to *which* profile to use — and a flag that the person
  behind it is verified human — live in two ENS text records on Sepolia:
  `app.ensight.profile` and `app.ensight.human`, on `reboleira.eth`."
- "The actual profile — the accessibility needs, the language, the
  reading level — is encrypted and stored on **0G Storage**. It never
  touches a server in plaintext."
- "Turning that profile plus the page's content graph into the UI you just
  saw happens inside a TEE on **0G Compute** — a sealed environment, not a
  public API call."
- "And 'one person, one profile' is enforced by **World ID 4.0** — a human
  attestation, not just a wallet signature."

**Optional:** switch to the pre-opened `sepolia.app.ens.domains/reboleira.eth`
tab and show the two text records live in the resolver.

---

## 5. Onboarding, optional beat (30s, only if time and network allow)

**Say:** "Setting up a profile is the same pipeline in reverse." Open
`http://localhost:8080/onboarding.html` (served by
`node scripts/onboarding-server.mjs`, which also signs the World ID request
locally so the signing key never reaches the browser).

**Click through, narrating each step:** connect wallet → World ID verify
(simulator, no Orb needed on staging) → fill the profile form → encrypt +
upload to 0G Storage → write the ENS pointer + attestation. "No backend
server holds your profile at any point in this flow."

Skip this step entirely if the room's network is shaky — it's a bonus, not
the core demo.

---

## 6. Close (15s)

**Say:** "Everything you just saw runs even if the network doesn't
cooperate — the live path always has a pre-computed fallback, so this demo
cannot go blank on stage." Land the last line: "Today the AI picks the
right layout once, per page load. The natural next step — out of scope for
this build — is a profile that keeps *learning* from how someone actually
uses the adapted page over time, not just what they declared up front."

---

## Cheat sheet

| Step | Where | Key line |
|---|---|---|
| 1 | `page-a-news.html` | "A normal page, nothing special." |
| 2 | Popup → toggle (Persona A) | "Adapted for *this* person — and links still hit the real page." |
| 3 | Switch to Persona B → toggle | "Same DOM, same URL, totally different UI." |
| 4 | ENS resolver / narration | "ENS pointer, 0G Storage blob, 0G Compute TEE, World ID human check." |
| 5 | `onboarding.html` (optional) | "Same pipeline, in reverse, no backend." |
| 6 | — | "Fixture fallback means this can't go blank. Phase 2: a loop that learns from usage." |
