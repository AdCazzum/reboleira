# Font del deck

Sottoinsiemi **latin** in woff2, scaricati una volta da Google Fonts e
committati perché `scripts/build-deck.mjs` li incorpora come data URI: il deck
deve restare un file unico, e la CSP degli artifact blocca qualunque richiesta
esterna — un CDN di font fallirebbe in silenzio, facendo scivolare tutte le
slide sul fallback di sistema senza che niente segnali l'errore.

| File | Famiglia | Assi | Licenza |
|---|---|---|---|
| `newsreader.woff2` | Newsreader | `opsz` 6–72, `wght` 400–700 | SIL Open Font License 1.1 |
| `plex-sans.woff2` | IBM Plex Sans | `wght` 400–600 | SIL Open Font License 1.1 |
| `plex-mono.woff2` | IBM Plex Mono | 400 | SIL Open Font License 1.1 |

La OFL consente la ridistribuzione, anche incorporata, purché i file non siano
venduti da soli e non si usi il nome della famiglia per un font modificato.
Qui non sono modificati: sono i binari originali di Google Fonts.

Per rinfrescarli, chiedere all'API `css2` il solo blocco `/* latin */` con uno
User-Agent moderno (altrimenti risponde con woff1) e salvare l'URL che ne
esce — per esempio:

```sh
curl -s -A "Mozilla/5.0 … Chrome/120" \
  "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400..700"
```
