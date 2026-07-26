import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '../src/manifest.config';

// Il marchio vive in quattro posti: il vettore sorgente, i PNG che Chrome
// pretende, e due copie inline (popup ed onboarding). Nessuno di questi si
// aggiorna da solo, e la modalità di guasto tipica è silenziosa: si tocca
// mark.svg, si dimentica `npm run icons`, e in toolbar resta l'icona vecchia
// senza che niente fallisca. Questi test rendono rumoroso quel caso.

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const SIZES = [16, 32, 48, 128] as const;

// L'header PNG è fisso: 8 byte di firma, poi un chunk IHDR che apre con
// larghezza e altezza come interi big-endian a 32 bit. Bastano 24 byte per
// sapere quanto è grande davvero un PNG, senza tirarsi dentro una libreria.
function dimensioniPng(percorso: string): { larghezza: number; altezza: number } {
  const buf = readFileSync(join(root, percorso));
  expect(buf.subarray(1, 4).toString('ascii'), `${percorso} non è un PNG`).toBe('PNG');
  expect(buf.subarray(12, 16).toString('ascii'), `${percorso}: primo chunk non IHDR`).toBe('IHDR');
  return { larghezza: buf.readUInt32BE(16), altezza: buf.readUInt32BE(20) };
}

describe('icone dell’estensione', () => {
  it('dichiara tutte le misure sia in icons sia in action.default_icon', () => {
    // Due campi distinti e non ridondanti: `icons` veste il gestore
    // estensioni e lo store, `default_icon` il bottone in toolbar. Se cade
    // solo il secondo, l'estensione sembra a posto ovunque tranne che nel
    // punto che l'utente guarda di più.
    for (const size of SIZES) {
      expect(manifest.icons?.[size], `icons[${size}] mancante`).toBeTruthy();
      expect(manifest.action?.default_icon?.[size], `default_icon[${size}] mancante`).toBeTruthy();
    }
  });

  it('punta a file che esistono e che sono grandi quanto dichiarano', () => {
    for (const size of SIZES) {
      const percorso = manifest.icons![size]!;
      expect(manifest.action!.default_icon![size]).toBe(percorso);
      expect(dimensioniPng(percorso)).toEqual({ larghezza: size, altezza: size });
    }
  });
});

describe('geometria del marchio', () => {
  // La `d` della M è duplicata per necessità: mark.svg deve restare un file
  // autonomo per il rasterizzatore, il popup non ha un foglio di stile
  // condiviso, e il masthead dell'onboarding è HTML statico che non può
  // importare nulla. Duplicare va bene finché divergere no.
  const sorgenti = {
    'src/ui/icons/mark.svg': read('src/ui/icons/mark.svg'),
    'src/ui/popup/popup.tsx': read('src/ui/popup/popup.tsx'),
    'demo/onboarding.html': read('demo/onboarding.html')
  };

  const percorsoLettera = /d="(M6 26V10[^"]+)"/;

  it('usa lo stesso tracciato in tutte le copie', () => {
    const trovati = Object.entries(sorgenti).map(([file, testo]) => {
      const m = testo.match(percorsoLettera);
      expect(m, `${file}: nessun tracciato della M`).not.toBeNull();
      return [file, m![1]] as const;
    });
    const atteso = sorgenti['src/ui/icons/mark.svg'].match(percorsoLettera)![1];
    for (const [file, d] of trovati) {
      expect(d, `${file} è fuori sincrono con mark.svg`).toBe(atteso);
    }
  });

  it('usa lo stesso scudo in tutte le copie', () => {
    for (const [file, testo] of Object.entries(sorgenti)) {
      expect(testo, `${file}: scudo assente o di misura diversa`).toMatch(
        /x="2"\s+y="2"\s+width="28"\s+height="28"\s+rx="4"/
      );
    }
  });

  // Il marchio regge il rimpicciolimento solo se ogni bordo cade su un pixel
  // intero anche a 16 px, cioè a metà della griglia 32. Una coordinata dispari
  // introdotta per "aggiustare" l'ottica a dimensione piena è invisibile qui e
  // devastante in toolbar, quindi la si prende subito.
  it('tiene tutte le coordinate su unità pari della griglia 32', () => {
    const d = sorgenti['src/ui/icons/mark.svg'].match(percorsoLettera)![1];
    const numeri = d.match(/\d+/g)!.map(Number);
    expect(numeri.filter(n => n % 2 !== 0), `coordinate dispari in "${d}"`).toEqual([]);
  });
});
