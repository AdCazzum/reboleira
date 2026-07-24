# ENSight — Generative UI personalizzata via ENS

**Design doc** · ETH Global Lisbon 2026 · Data: 2026-07-24 · Nome di lavoro: **ENSight** (provvisorio)

## 1. Visione

Un'estensione Chrome che usa la **generative UI** per **rigenerare l'interfaccia dei siti web su misura per la persona**, in base a un profilo di identità e preferenze registrato nell'**ENS**.

Stessa pagina, persone diverse, interfacce diverse: chi ha bisogno di accessibilità (dislessia, ipovisione, riduzione del carico cognitivo) e chi ha preferenze di contenuto (lingua, livello di competenza, tono) vede la stessa informazione renderizzata nel modo per lui più fruibile.

L'asse di personalizzazione è **generale**: un profilo unico copre sia accessibilità sia preferenze, e l'AI decide cosa applicare pagina per pagina. La profondità della trasformazione è **re-layout generativo completo**: l'AI rigenera l'interfaccia, non si limita a ristilizzare.

## 2. Sponsor e ruoli

Tre sponsor, ciascuno con un ruolo **necessario** (niente loghi decorativi).

| Sponsor | Ruolo nel sistema | Track candidato |
|---|---|---|
| **ENS** ($5K) | Identità + preferenze della persona. I **text record** contengono il puntatore al profilo e il flag di verifica umana. | Creative Use of text records |
| **0G** ($15K) | Copre due bisogni: **0G Storage (cifrato)** per il profilo sensibile e **0G Compute (TEE-sealed)** per l'inferenza privata e verificabile della generative UI. | AI Products |
| **World** ($15K) | **Prova di umanità reale e unica** (una persona → un profilo) via World ID / Selfie Check. Step di verifica nell'onboarding. | Identity Attestation |

## 3. Architettura (3 strati)

**A. Estensione Chrome (MV3)** — il client
- *Content script*: estrae dal DOM un **content graph** semantico (titoli, testo, link, immagini, form, azioni), ripulito dal clutter, mantenendo il riferimento al nodo DOM originale di ogni blocco.
- *Runtime di rendering*: renderizza la UI generata in overlay isolato (shadow DOM), con toggle originale ⇄ adattato.
- *Popup*: connetti wallet/ENS, on-off, stato del profilo.

**B. Strato identità & profilo** — ENS + World + 0G Storage
- Wallet connect → risoluzione nome ENS.
- World ID verifica umanità unica; salviamo solo il nullifier/attestation.
- Il profilo ricco è **cifrato e caricato su 0G Storage**.
- Il **text record ENS** contiene solo il **puntatore** al blob + flag di verifica World. Pubblico ma innocuo.

**C. Motore di generative UI** — 0G Compute
- Input: content graph + profilo decifrato lato client.
- LLM su **0G Compute (TEE-sealed)** → produce una **UI spec** strutturata (schema vincolato).
- Il profilo sensibile non lascia mai un ambiente privato (browser o TEE sigillato). Inferenza privata e verificabile.

## 4. Flusso dati

```
ONBOARDING (una tantum)
  wallet → ENS  →  World ID verify  →  compila profilo (wizard)
       →  cifra (chiave da firma wallet)  →  upload 0G Storage
       →  scrivi puntatore + flag umano in ENS text record (tx Sepolia)

USO (ad ogni pagina)
  1. visiti un sito → content script estrae il content graph
  2. leggi puntatore da ENS text record → scarica blob da 0G Storage → decifra (chiave dal wallet)
  3. content graph + profilo  →  0G Compute (TEE)  →  UI spec
  4. runtime renderizza la UI spec nella pagina → toggle originale ⇄ adattato
```

## 5. Componenti (5)

1. **Content Extractor** (content script) — pass tipo Readability → `blocks[]` con `{id, type, text, href/src, domRef}`. Mantiene il riferimento al DOM originale di ogni blocco.
2. **Profile Manager** — wallet connect, risoluzione ENS, stato verifica World, fetch puntatore, download + decifratura da 0G Storage. Espone il `PersonaProfile` decifrato e lo cachea in sessione.
3. **GenUI Engine (client)** — assembla il prompt (profilo + content graph + contratto di schema), chiama 0G Compute (TEE), **valida** la UI spec contro lo schema (ripara/rifiuta se invalida).
4. **UI Spec Renderer** (runtime) — renderizza la UI spec in overlay shadow-DOM con runtime leggero (preact/lit). **Ricollega** gli elementi interattivi ai `domRef` originali, applica i design token, gestisce il toggle.
5. **Popup / Onboarding UI** — wallet, World verify, wizard profilo, stato.

## 6. Schema della UI spec (il contratto)

```jsonc
{
  "theme":        { "fontScale", "contrast", "font", "lineSpacing", "colorMode", "density" },
  "language":     "it",
  "readingLevel": "simple | standard | expert",
  "sections": [
    { "role": "primary|summary|content|actions|navigation|aside|hidden",
      "priority": 1,
      "heading": "…",
      "content": [ {"type":"text","text":"…"},
                   {"type":"action","refId":"block-12","label":"…"},  // link/azione REALE
                   {"type":"image","refId":"block-8"} ],
      "sourceRefs": ["block-3","block-4"] }
  ],
  "hidden": ["block-9"]
}
```

**Decisione di sicurezza fondamentale**: l'AI può **riscrivere il testo** (semplificare, tradurre, cambiare livello) ma **link e azioni provengono sempre da `refId` reali del DOM** — mai URL inventati. Elimina le allucinazioni di navigazione, preserva l'interattività (un bottone generato attiva l'azione vera), dà fiducia ai giudici. Lo `sourceRefs` abilita la Fase 2 (attribuzione delle interazioni ai contenuti).

## 7. Privacy e gestione chiavi

**Cosa è pubblico e cosa no:**

| Dove | Cosa | Sensibile? |
|---|---|---|
| ENS text record (pubblico, on-chain) | puntatore al blob + flag umano World | No |
| 0G Storage (cifrato) | il `PersonaProfile` vero (disabilità, preferenze) | **Sì → cifrato** |
| 0G Compute (TEE) | profilo in chiaro **solo** dentro l'enclave sigillata | effimero, sigillato |

Il dato sensibile esiste solo in due posti: il browser dell'utente e un TEE sigillato. Mai in un log di un'API terza.

**Gestione chiavi**: chiave derivata da **firma del wallet** — l'utente firma un messaggio deterministico → HKDF → chiave AES-GCM. La chiave non lascia mai il client, nessun segreto extra. In lettura: download ciphertext da 0G → decifratura locale → profilo passato nel TEE per l'inferenza.

## 8. Demo

**Target: pagine HTML mock controllate** (create e verificate da noi), per affidabilità sul palco. L'architettura resta generale, ma la demo gira su contenuto noto.

- **Pagina A — articolo/news**: densa, con clutter → mostra l'asse *accessibilità*.
- **Pagina B — prodotto o documentazione**: → mostra l'asse *preferenze/competenza*.

**Il "momento wow": stessa pagina, due persone.**
- **Persona A** — dislessia, italiano, principiante → font grande, linguaggio semplificato, summary-first, clutter nascosto.
- **Persona B** — esperto, inglese, ipovisione/alto contrasto → denso, riordinato, tecnico.

Stessa pagina + due text record ENS → due UI completamente diverse. Lo screenshot side-by-side è la tesi del progetto dimostrata.

**Script (~3 min):** 1) pagina mock raw; 2) Persona A: toggle → trasformazione (badge World-verified, profilo da ENS); 3) Persona B: stessa pagina → UI diversa; 4) "sotto il cofano": puntatore nel text record ENS, blob cifrato su 0G, inferenza in TEE; 5) accenno Fase 2.

## 9. Testing

- **Unit**: content extractor sulle mock (content graph deterministico); validatore UI spec (rifiuta refId inventati/malformati); renderer (azione generata → scatta il `domRef` reale).
- **Integration**: pipeline completa su pagina mock; round-trip encrypt → 0G → decrypt.
- **Fallback critico**: UI spec **pre-calcolata e cachata** per ogni (pagina, persona). Se 0G Compute è lento/giù sul palco, la demo non fallisce mai. Non negoziabile.

## 10. Scope

**Fase 1 (hackathon — si costruisce):**
Estensione MV3 · wallet + ENS su Sepolia · step World verify · wizard profilo · encrypt + 0G Storage · scrittura text record ENS · content extractor (tarato sulle mock) · chiamata genUI su 0G Compute · UI spec renderer + toggle · 2 personas + 2 pagine mock · fallback pre-calcolato.

**Fase 2 (documentata, non costruita):**
Loop di apprendimento comportamentale (l'estensione osserva le interazioni — cosa clicchi, cosa salti, dove ti fermi — e raffina il profilo nel tempo) · robustezza su siti reali arbitrari · sync cross-device · condivisione profilo con i servizi · variante per agenti AI (ENSIP-26 agent records).

## 11. Tagli YAGNI espliciti

Niente supporto a siti arbitrari (solo mock per la demo) · niente modello on-device · niente sistema account oltre il wallet · niente multilingua oltre il necessario alla demo · niente loop comportamentale in Fase 1.

## 12. Costi (zero-budget)

Il progetto è realizzabile interamente a **costo zero** usando testnet e strumenti locali.

| Componente | Costo | Come |
|---|---|---|
| Estensione Chrome | €0 | Caricata "unpacked" in dev (i $5 del Web Store solo se si pubblica — non serve). |
| ENS | €0 | Testnet Sepolia: registrazione + text record pagati in ETH di test dai faucet. |
| 0G Storage + Compute | €0 | Testnet 0G: storage e inferenza TEE con token da faucet. |
| World ID | €0 | Developer Portal + IDKit in staging. |
| Wallet + pagine mock | €0 | MetaMask e file HTML statici in locale. |
| LLM per la generative UI | €0 | Via 0G Compute testnet; fallback gratis: UI spec pre-calcolate + Ollama locale in dev. |

**Stato verificato live (2026-07-24):**
- ✅ **0G Compute usabile da browser**: SDK `@0gfoundation/0g-compute-ts-sdk`, percorso *Direct*, funziona in browser con ethers.js + MetaMask, **nessun backend Node** → adatto al service worker dell'estensione. Modelli: chatbot tipo GPT/DeepSeek, Llama-3.3-70B, DeepSeek-R1-70B.
- ✅ **World ID gratis**: IDKit + Developer Portal, app di staging (`app_staging_...`).
- ✅ **ENS su Sepolia** funziona (`sepolia.app.ens.domains`); *caveat*: i nomi Sepolia vengono resettati periodicamente ai redeploy — ok per hackathon breve, non fare affidamento sulla persistenza.

**Azione Giorno 1 (unico intoppo reale)**: l'inferenza 0G richiede ~1 OG per sub-account e **3 OG per creare il ledger** (OG di testnet → €0), ma il faucet pubblico eroga solo **0,1 OG/giorno**. Procurarsi ≥3–4 OG testnet richiedendo un **top-up via Discord/booth 0G** all'evento. Da fare subito, non alla vigilia della demo.

**Altri caveat minori**: faucet 0G richiede account X/Twitter; alcuni faucet Sepolia chiedono mini-saldo mainnet o login GitHub/Google (esistono no-KYC). Fallback all'inferenza live comunque coperto da UI spec pre-calcolate (demo) e Ollama locale (dev).

## 13. Assunzioni

- L'utente dispone (o gli forniamo) un nome ENS su **Sepolia** per la demo, per evitare gas su mainnet.
- 0G Compute è richiamabile da client browser (**verificato**: SDK Direct funziona in browser con MetaMask, senza backend); resta da validare che un provider serva un modello adatto e che si disponga di ≥3–4 OG testnet per il ledger. Fallback pre-calcolato copre comunque la demo.
- World ID è integrabile via widget IDKit nel flusso di onboarding dell'estensione.
