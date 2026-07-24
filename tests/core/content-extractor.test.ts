// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { extractContentGraph } from '../../src/core/content-extractor';

function docFrom(html: string): Document {
  const d = document.implementation.createHTMLDocument('t');
  d.body.innerHTML = html; return d;
}

describe('extractContentGraph', () => {
  it('estrae heading, paragrafo e link con id progressivi', () => {
    const doc = docFrom('<h1>Titolo</h1><p>Ciao mondo</p><a href="/x">Vai</a>');
    const g = extractContentGraph(doc);
    expect(g.blocks.map(b => b.type)).toEqual(['heading','paragraph','link']);
    expect(g.blocks[0]).toMatchObject({ type: 'heading', level: 1, text: 'Titolo' });
    expect(g.blocks[2]).toMatchObject({ type: 'link', href: '/x', text: 'Vai' });
  });

  it('tagga il DOM con data-ensight-id coerenti con gli id dei block', () => {
    const doc = docFrom('<p>uno</p><p>due</p>');
    const g = extractContentGraph(doc);
    const tagged = doc.querySelectorAll('[data-ensight-id]');
    expect(tagged.length).toBe(2);
    expect((tagged[0] as HTMLElement).dataset.ensightId).toBe(g.blocks[0].id);
  });

  it('classifica button come action e ul come list', () => {
    const doc = docFrom('<button>Compra</button><ul><li>a</li><li>b</li></ul>');
    const g = extractContentGraph(doc);
    expect(g.blocks[0]).toMatchObject({ type: 'action', text: 'Compra' });
    expect(g.blocks[1]).toMatchObject({ type: 'list', items: ['a','b'] });
  });

  it('ignora script/style e nodi vuoti', () => {
    const doc = docFrom('<style>.x{}</style><p>   </p><p>ok</p><script>1</script>');
    const g = extractContentGraph(doc);
    expect(g.blocks.map(b => b.text)).toEqual(['ok']);
  });
});
