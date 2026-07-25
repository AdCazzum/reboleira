import { describe, it, expect } from 'vitest';
import { normalizeUISpec } from '../../src/core/uispec-normalize';
import { assertValidUISpec } from '../../src/core/uispec-validate';
import type { ContentGraph } from '../../src/core/types';

const graph: ContentGraph = {
  url: 'http://x/page-a-news.html',
  title: 't',
  lang: 'it',
  blocks: [
    { id: 'block-0', type: 'paragraph', text: 'ciao' },
    { id: 'block-1', type: 'link', href: '/x', text: 'vai' },
    { id: 'block-2', type: 'image', src: '/i.svg' }
  ]
} as ContentGraph;

/** UISpec valido minimo, su cui i test iniettano le deviazioni del modello. */
function spec(sections: unknown[]): Record<string, unknown> {
  return {
    theme: { fontScale: 1.2, contrast: 'high', font: 'dyslexic', lineSpacing: 1.5, colorMode: 'light', density: 'comfortable' },
    language: 'it',
    readingLevel: 'simple',
    sections,
    hidden: []
  };
}

describe('normalizeUISpec — deviazioni tipiche di un modello piccolo', () => {
  it('lascia intatto uno spec già valido', () => {
    const valid = spec([{ role: 'primary', priority: 1, content: [{ type: 'text', text: 'a' }], sourceRefs: ['block-0'] }]);
    expect(normalizeUISpec(structuredClone(valid))).toEqual(valid);
  });

  it('deduce il tipo dalla forma quando il modello inventa il nome (paragraph/heading/bullets/button)', () => {
    const out = normalizeUISpec(spec([{
      role: 'primary', priority: 1, sourceRefs: ['block-0'],
      content: [
        { type: 'paragraph', text: 'un paragrafo' },
        { type: 'heading', text: 'un titolo' },
        { type: 'bullet_list', items: ['a', 'b'] },
        { type: 'button', refId: 'block-1', label: 'vai' },
        { type: 'img', refId: 'block-2' }
      ]
    }])) as any;

    expect(out.sections[0].content).toEqual([
      { type: 'text', text: 'un paragrafo' },
      { type: 'text', text: 'un titolo' },
      { type: 'list', items: ['a', 'b'] },
      { type: 'action', refId: 'block-1', label: 'vai' },
      { type: 'image', refId: 'block-2' }
    ]);
    // e il risultato passa la validazione stretta, refId inclusi
    expect(() => assertValidUISpec(out, graph)).not.toThrow();
  });

  it('accetta un item che è una semplice stringa', () => {
    const out = normalizeUISpec(spec([{ role: 'content', priority: 1, sourceRefs: [], content: ['testo nudo'] }])) as any;
    expect(out.sections[0].content).toEqual([{ type: 'text', text: 'testo nudo' }]);
  });

  it('legge il testo anche da campi alternativi (content/value/title)', () => {
    const out = normalizeUISpec(spec([{
      role: 'content', priority: 1, sourceRefs: [],
      content: [{ type: 'heading', value: 'da value' }, { type: 'p', content: 'da content' }]
    }])) as any;
    expect(out.sections[0].content).toEqual([
      { type: 'text', text: 'da value' },
      { type: 'text', text: 'da content' }
    ]);
  });

  it('appiattisce le liste di oggetti, che altrimenti renderebbero [object Object]', () => {
    const out = normalizeUISpec(spec([{
      role: 'content', priority: 1, sourceRefs: [],
      content: [{ type: 'list', items: [{ text: 'primo' }, { label: 'secondo' }, 'terzo'] }]
    }])) as any;
    expect(out.sections[0].content).toEqual([{ type: 'list', items: ['primo', 'secondo', 'terzo'] }]);
  });

  it('scarta gli item irriconoscibili invece di far cadere tutto lo spec', () => {
    const out = normalizeUISpec(spec([{
      role: 'content', priority: 1, sourceRefs: [],
      content: [{ type: 'text', text: 'buono' }, { type: 'chart', dataset: [1, 2, 3] }]
    }])) as any;
    expect(out.sections[0].content).toEqual([{ type: 'text', text: 'buono' }]);
  });

  it('rimappa i role fuori vocabolario, con "content" come ripiego che non nasconde nulla', () => {
    const out = normalizeUISpec(spec([
      { role: 'main', priority: 1, sourceRefs: [], content: [] },
      { role: 'sidebar', priority: 2, sourceRefs: [], content: [] },
      { role: 'nav', priority: 3, sourceRefs: [], content: [] },
      { role: 'qualcosa-di-inventato', priority: 4, sourceRefs: [], content: [] }
    ])) as any;
    expect(out.sections.map((s: any) => s.role)).toEqual(['primary', 'aside', 'navigation', 'content']);
  });

  it('converte i numeri arrivati come stringhe e riporta il tema nei limiti', () => {
    const out = normalizeUISpec({
      ...spec([{ role: 'primary', priority: '2', sourceRefs: [], content: [] }]),
      theme: { fontScale: '4', contrast: 'high', font: 'dyslexic', lineSpacing: '0.5', colorMode: 'light', density: 'comfortable' }
    }) as any;
    expect(out.sections[0].priority).toBe(2);
    expect(out.theme.fontScale).toBe(3); // clamp al massimo dello schema
    expect(out.theme.lineSpacing).toBe(1); // clamp al minimo
  });

  it('non inventa e non tocca i refId: un refId allucinato resta e la validazione lo rifiuta', () => {
    const out = normalizeUISpec(spec([{
      role: 'primary', priority: 1, sourceRefs: [],
      content: [{ type: 'button', refId: 'block-99', label: 'inventato' }]
    }])) as any;
    expect(out.sections[0].content[0].refId).toBe('block-99');
    expect(() => assertValidUISpec(out, graph)).toThrow(/refId sconosciuto/);
  });

  it('su input non-oggetto non fa nulla, lasciando parlare la validazione', () => {
    expect(normalizeUISpec('non un oggetto')).toBe('non un oggetto');
    expect(normalizeUISpec(null)).toBe(null);
  });
});
