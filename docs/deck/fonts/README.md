# Font del deck

Sottoinsiemi **latin** in woff2, committati perché `scripts/build-deck.mjs` li
incorpora come data URI: il deck deve restare un file unico, e la CSP degli
artifact blocca qualunque richiesta esterna — un CDN di font fallirebbe in
silenzio, facendo scivolare tutte le slide sul fallback di sistema senza che
niente segnali l'errore.

## Perché sono statici e non variabili

Google Fonts serve queste due famiglie solo come font variabili, anche quando
si chiede un peso singolo. **Chromium non incorpora un font variabile quando
stampa**: `scripts/export-deck-pdf.mjs` produceva un PDF con dentro solo
IBM Plex Mono (statico) e Comic Sans (di sistema), mentre Newsreader e Plex
Sans — cioè quasi tutto il testo — sparivano e ogni lettore PDF sostituiva
qualcos'altro, con le metriche sbagliate.

I file qui sono quindi **istanze statiche** ricavate dai variabili, una per
peso usato. L'asse `opsz` di Newsreader è fissato al valore giusto per il
ruolo di quel peso, che è anche il motivo per cui il deck non usa più
`font-variation-settings`: la dimensione ottica è dentro al file.

| File | Famiglia | Istanza | Ruolo nel deck |
|---|---|---|---|
| `newsreader-400.woff2` | Newsreader | `wght` 400, `opsz` 20 | serif da testo: citazioni, callout |
| `newsreader-500.woff2` | Newsreader | `wght` 500, `opsz` 60 | serif da titolo: h1, h2, nomi dei partner |
| `newsreader-600.woff2` | Newsreader | `wght` 600, `opsz` 20 | grassetto dentro i callout |
| `plex-sans-400.woff2` | IBM Plex Sans | `wght` 400 | testo corrente e didascalie |
| `plex-sans-500.woff2` | IBM Plex Sans | `wght` 500 | numeri e accenti dell'interfaccia |
| `plex-sans-600.woff2` | IBM Plex Sans | `wght` 600 | occhielli, titoli delle card, intestazioni |
| `plex-mono-400.woff2` | IBM Plex Mono | statico all'origine | solo valori on-chain letterali |

Tutte SIL Open Font License 1.1, che consente la ridistribuzione anche
incorporata e anche modificata (nessuna delle due famiglie ha un Reserved Font
Name). Il nome interno delle istanze è lasciato invariato apposta: sono
istanze del disegno originale, non un font ridisegnato.

## Rigenerarli

Servono i variabili di partenza. Chiedere all'API `css2` il solo blocco
`/* latin */` con uno User-Agent moderno — altrimenti risponde con woff1 — e
scaricare l'URL che ne esce:

```sh
curl -s -A "Mozilla/5.0 … Chrome/120" \
  "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400..700"
curl -s -A "Mozilla/5.0 … Chrome/120" \
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400..600"
curl -s -A "Mozilla/5.0 … Chrome/120" \
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400"
```

Poi istanziarli con fonttools (`pip install fonttools brotli`), una volta sola:

```python
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

for src, loc, out in [
    ('newsreader', {'wght': 400, 'opsz': 20}, 'newsreader-400'),
    ('newsreader', {'wght': 500, 'opsz': 60}, 'newsreader-500'),
    ('newsreader', {'wght': 600, 'opsz': 20}, 'newsreader-600'),
    ('plex-sans',  {'wght': 400},             'plex-sans-400'),
    ('plex-sans',  {'wght': 500},             'plex-sans-500'),
    ('plex-sans',  {'wght': 600},             'plex-sans-600'),
]:
    f = TTFont(f'{src}.woff2')
    # updateFontNames=False: la tabella STAT di Newsreader non dichiara un
    # Axis Value per opsz 20, e con l'aggiornamento dei nomi acceso instancer
    # si rifiuta di procedere.
    inst = instancer.instantiateVariableFont(f, loc, inplace=False, optimize=True,
                                             updateFontNames=False)
    assert 'fvar' not in inst, f'{out} è ancora variabile'
    inst.flavor = 'woff2'
    inst.save(f'{out}.woff2')
```

Il controllo che conta non è che il deck si veda bene a schermo — si vedeva
bene anche prima — ma che il PDF contenga davvero le famiglie:

```sh
node scripts/export-deck-pdf.mjs
```

Lo script fallisce se una famiglia attesa non è finita dentro al file.
