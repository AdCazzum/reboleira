// @vitest-environment jsdom
//
// Prova automatica del milestone "demo funzionante offline" del Task 8: senza Chrome,
// senza rete, guida l'intera pipeline adaptPage (extract -> getSpec(fixture) -> validate
// -> render) sulle pagine demo reali e verifica che l'output renderizzato rifletta la
// persona attiva (contenuto riscritto per quella persona presente, blocchi marcati
// `hidden` dalla fixture assenti).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { adaptPage } from '../../src/content/adapt';
import { fixtureFor } from '../../demo/fixtures';
import type { PersonaProfile } from '../../src/core/types';

function loadBody(file: string): Document {
  const html = readFileSync(`demo/${file}`, 'utf8');
  const doc = document.implementation.createHTMLDocument('t');
  doc.body.innerHTML = html.replace(/^[\s\S]*?<body[^>]*>|<\/body>[\s\S]*$/g, '');
  return doc;
}

const personaAProfile: PersonaProfile = JSON.parse(readFileSync('demo/personas/persona-a.json', 'utf8'));
const personaBProfile: PersonaProfile = JSON.parse(readFileSync('demo/personas/persona-b.json', 'utf8'));

describe('offline end-to-end (fixture path, nessuna rete/wallet)', () => {
  it('page-a-news + personaA: mostra il riassunto in italiano, nasconde il promo banner', async () => {
    const doc = loadBody('page-a-news.html');
    const root = await adaptPage(doc, personaAProfile, async () =>
      fixtureFor('http://x/demo/page-a-news.html', 'personaA'));

    const text = root.shadowRoot!.textContent ?? '';
    // Contenuto specifico della fixture personaA (riscritto/semplificato, non verbatim nella pagina originale)
    expect(text).toContain('Il porto di Genova ha raddoppiato il traffico di container nel 2026');
    // block-0 (banner promozionale) è in "hidden" nella fixture uispec-a-personaA
    expect(text).not.toContain('Offerta lampo: abbonati oggi al Corriere Fittizio');
  });

  it('page-b-product + personaB: mostra la scheda tecnica in inglese, nasconde la nav', async () => {
    const doc = loadBody('page-b-product.html');
    const root = await adaptPage(doc, personaBProfile, async () =>
      fixtureFor('http://x/demo/page-b-product.html', 'personaB'));

    const text = root.shadowRoot!.textContent ?? '';
    // Contenuto specifico della fixture personaB (riassunto tecnico esperto)
    expect(text).toContain('FIDO2/WebAuthn/U2F/OTP hardware authenticator with USB-C and NFC connectivity');
    // block-0 (nav del sito) è in "hidden" nella fixture uispec-b-personaB
    expect(text).not.toContain('Home\n    Products\n    Documentation\n    Support');
  });
});
