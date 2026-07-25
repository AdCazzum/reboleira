# End-to-end: come verificare ENSight davvero

L'e2e di ENSight sta su **due livelli**, perché una parte è automatizzabile a costo
zero e una parte richiede un wallet umano che approva firme e transazioni.

| Livello | Cosa prova | Costo | Comando |
|---|---|---|---|
| 1 — automatico | l'estensione come artefatto: manifest, service worker, content script, messaggi, bridge MAIN world, pipeline di adattamento, popup, fallback | €0, offline | `npm run e2e` |
| 2 — manuale live | le catene on-chain/off-chain: World ID, 0G Storage, puntatore ENS, inferenza 0G Compute | testnet (OG + SepETH) | procedura sotto |

Nessuno dei due sostituisce l'altro. Il livello 1 gira in CI e a ogni modifica; il
livello 2 si esegue prima di una demo.

> Nota su cosa NON è un e2e: `tests/content/offline-e2e.test.ts` guida
> `adaptPage()` direttamente sotto jsdom. Verifica la pipeline, ma non carica il
> manifest, non avvia il service worker, non inietta nulla e non manda un solo
> messaggio Chrome. Passa anche se l'estensione è completamente rotta.

---

## Livello 1 — e2e automatico attraverso l'estensione

```bash
npm run e2e                 # headless
E2E_HEADED=1 npm run e2e    # guardalo in una finestra vera
E2E_KEEP=1 npm run e2e      # lascia il browser aperto alla fine
```

Lo script (`scripts/e2e.mjs`) builda con `--mode e2e`, carica `dist-e2e/` unpacked
in un Chromium reale, serve le pagine demo su http e pilota lo stesso percorso che
percorre una persona.

**Deterministico per costruzione:** `.env.e2e` punta ogni dipendenza live su una
porta chiusa, così ENS/0G/Compute falliscono immediatamente e il codice cade nelle
persona statiche + fixture pre-calcolate. Nessuna rete, nessun wallet, nessun
fondo, nessuna firma da approvare. Come effetto collaterale utile, ogni run
esercita per davvero la rete di sicurezza da cui dipende la demo.

Cosa verifica (19 check):

- il service worker si avvia e l'estensione ottiene un id;
- il content script risponde a `chrome.tabs.sendMessage` (non basta che il file
  esista: deve essere in ascolto);
- `injected.js` è raggiungibile come `web_accessible_resource` **e** il bridge del
  MAIN world risponde a un round trip — cioè lo script è stato *eseguito*, non solo
  servito;
- toggle → la pagina viene sostituita dalla UI adattata, con l'originale nascosta;
- persona A e persona B producono UI diverse sulla stessa pagina;
- i blocchi marcati `hidden` nella fixture non finiscono nell'output;
- un secondo toggle ripristina la pagina originale intatta;
- entrambe le pagine demo (news e prodotto) si adattano;
- il popup renderizza, distingue "profilo non configurato" da "lettura ENS
  fallita", e il bottone di onboarding segnala il server spento invece di aprire
  una tab bianca;
- i due fallback (profilo e UISpec) annunciano in console di essere scattati;
- nessun errore JS in pagina.

Cosa **non** copre, per scelta: qualunque cosa richieda un wallet o la testnet.
Quella è la procedura sotto.

---

## Livello 2 — e2e manuale live

### Prerequisiti

Per procurarsi i token e le credenziali (faucet, nome ENS su Sepolia, app World nel
Developer Portal) segui `docs/RUNBOOK.md`. Serve, in `.env`:

| Variabile | Serve a |
|---|---|
| `VITE_SEPOLIA_RPC` | leggere/scrivere i text record ENS |
| `VITE_ENS_NAME` | il nome che porta il puntatore al profilo |
| `VITE_ZEROG_RPC` | upload su 0G Storage e inferenza |
| `WORLD_RP_SIGNING_KEY`, `WORLD_RP_ID` | firma di `rp_context` lato server (World ID 4.0) |
| `VITE_ZEROG_INFERENCE_PROVIDER` | **solo** per la genUI live (passo 5); se vuota, si usa la fixture |

Nel wallet: SepETH sull'account che gestisce il nome ENS, e OG su 0G Galileo
(chainId 16602) sull'account che carica su 0G Storage.

### 1. Costruisci e carica l'estensione

```bash
npm run build
```

`chrome://extensions` → Developer mode → **Load unpacked** → seleziona `dist/`.

✅ *Atteso:* l'estensione appare senza errori. Cliccando "service worker" la console
mostra `[ENSight] service worker attivo`.

> Rilanciare `npm run build` dopo aver modificato `.env` non è opzionale: i valori
> `VITE_*` sono compilati dentro il bundle. E dopo un rebuild, ricarica
> l'estensione da `chrome://extensions`.

### 2. Esegui l'onboarding

```bash
node scripts/onboarding-server.mjs      # serve demo/ su :8080 e firma rp_context
```

Apri il popup dell'estensione → **Configura profilo** (o vai a
`http://localhost:8080/onboarding.html`). Cinque passi:

1. **Connect** — MetaMask si collega.
2. **Verify human** — widget World ID 4.0; in `staging` verifica col simulatore.
3. **Profile** — compila lingua, livello di lettura, accessibilità, domini.
4. **Encrypt & upload** — firma `SIGN_MESSAGE`, deriva la chiave AES-GCM, cifra il
   profilo e lo carica su 0G Storage. MetaMask passa a 0G Galileo e la transazione
   **spende OG**.
5. **Write ENS** — due `setText` su Sepolia: il puntatore al blob e l'attestazione
   World. **Spende SepETH.**

✅ *Atteso:* il passo 4 stampa un root hash; il passo 5 due hash di transazione.
Annota il root hash: è l'URI del profilo.

### 3. Verifica che l'estensione veda il profilo

Apri il popup.

✅ *Atteso:* `Profilo su <nome>.eth: **trovato**`, con il root hash abbreviato e
`umano verificato`. Il popup legge i text record ENS in diretta — se dice "trovato"
significa che la catena ENS→0G è pubblicata e leggibile.

❌ *Se dice "non configurato":* i record ENS non ci sono. Rifai il passo 5.
❌ *Se dice "lettura ENS fallita":* problema di RPC/rete, non di dati — il messaggio
riporta l'errore.

### 4. Adatta una pagina con il profilo live

Apri `http://localhost:8080/page-a-news.html` (le fixture di riserva sono mappate
per URL, quindi servi le pagine, non aprirle come `file://`). Apri la **console
della pagina** (DevTools), poi popup → **Adatta questa pagina**.

MetaMask chiede una firma (`personal_sign` di `SIGN_MESSAGE`): serve a riderivare la
chiave che decifra il profilo. Approvala.

✅ *Atteso in console:*

```
[ENSight] profilo: LIVE (puntatore ENS -> blob cifrato su 0G Storage)
[ENSight] UISpec: FALLBACK alla fixture pre-calcolata — ...
```

La prima riga è il traguardo del livello 2: il profilo che sta pilotando la UI è
stato letto da ENS, scaricato cifrato da 0G e decifrato in locale. La seconda è
attesa se non hai configurato `VITE_ZEROG_INFERENCE_PROVIDER` (vedi passo 5).

❌ *Se leggi `profilo: FALLBACK`:* l'errore è stampato accanto. Sta girando la
persona statica, non il tuo profilo — la UI si adatta comunque, ma non è live.

> Il profilo viene messo in cache in `chrome.storage.session` per URI, quindi la
> firma è richiesta una volta per sessione del browser, non a ogni pagina.

### 5. (Opzionale) genUI live su 0G Compute

Serve un provider di inferenza e un ledger capiente:

```bash
PRIVATE_KEY=0x... npx tsx scripts/try-inference.ts    # elenca i provider
PRIVATE_KEY=0x... npx tsx scripts/setup-ledger.ts     # crea/finanzia il ledger
```

Metti l'indirizzo scelto in `VITE_ZEROG_INFERENCE_PROVIDER`, `npm run build`,
ricarica l'estensione, ripeti il passo 4.

L'inferenza gira nel MAIN world (il broker 0G ha bisogno di un Signer vero, che
esiste solo dove c'è `window.ethereum`): MetaMask passerà a 0G Galileo e il primo
adattamento invia una transazione di `acknowledgeProviderSigner`. Il broker è
memoizzato, quindi succede una volta per pagina.

✅ *Atteso:* `[ENSight] UISpec: LIVE (inferenza 0G Compute)`, e una UI generata dal
modello invece della fixture. Metti in conto qualche secondo di attesa.

⚠️ Non ancora verificato live end-to-end (vedi tabella sotto). Se fallisce, la
fixture entra automaticamente: la demo non si rompe.

### 6. Prova antincendio del fallback

Prima di una demo, verifica che la rete di sicurezza tenga: metti un RPC sbagliato
in `.env`, `npm run build`, ricarica, e adatta di nuovo.

✅ *Atteso:* la pagina si adatta comunque, la console dice `FALLBACK` su entrambe le
righe, nessun errore visibile all'utente. È lo stesso percorso che `npm run e2e`
esercita a ogni run.

---

## Stato di verifica, onesto

| Tratta | Stato |
|---|---|
| Estensione: manifest, SW, content script, messaggi, adattamento, popup, fallback | ✅ automatizzato (`npm run e2e`, 19/19) |
| Bridge MAIN world (round trip postMessage) | ✅ automatizzato |
| World ID 4.0 → attestazione | ✅ verificato live dall'utente (onboarding) |
| Upload cifrato su 0G Storage | ✅ verificato live dall'utente (onboarding + `scripts/try-storage.ts`) |
| Scrittura dei text record ENS | ✅ verificato live dall'utente (onboarding + `scripts/try-ens.ts`) |
| Inferenza 0G Compute | ✅ verificata live via `scripts/try-inference.ts` (Node) |
| **Download del profilo da 0G dentro l'estensione** | ⚠️ **da verificare live** — passo 4 |
| **Inferenza 0G Compute dentro l'estensione** | ⚠️ **da verificare live** — passo 5 |

Le due righe ⚠️ sono percorsi la cui implementazione è stata corretta di recente
(prima erano irraggiungibili nel browser: `zerog-storage.ts` scaricava via
`node:fs`, e il bridge del MAIN world non partiva affatto perché `injected.js`
veniva iniettato come script classico pur essendo un modulo). Il codice è a posto e
tipizzato, ma solo un wallet con fondi può chiudere il cerchio.
