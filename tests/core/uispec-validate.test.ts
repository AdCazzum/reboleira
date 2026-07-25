import { describe, it, expect } from 'vitest';
import { assertValidUISpec } from '../../src/core/uispec-validate';
import type { ContentGraph } from '../../src/core/types';

const graph: ContentGraph = { url: '', title: 't', blocks: [
  { id: 'block-0', type: 'heading', text: 'H', level: 1 },
  { id: 'block-1', type: 'action', text: 'Buy' },
]};
const good = {
  theme: { fontScale: 1.2, contrast: 'high', font: 'dyslexic', lineSpacing: 1.6, colorMode: 'light', density: 'comfortable' },
  language: 'it', readingLevel: 'simple',
  sections: [{ role: 'primary', priority: 1, heading: 'H',
    content: [{ type: 'text', text: 'ciao' }, { type: 'action', refId: 'block-1', label: 'Compra' }],
    sourceRefs: ['block-0'] }],
  hidden: []
};

describe('assertValidUISpec', () => {
  it('accetta una spec valida con refId esistenti', () => {
    expect(() => assertValidUISpec(good, graph)).not.toThrow();
  });
  it('rifiuta schema malformato (readingLevel sconosciuto)', () => {
    expect(() => assertValidUISpec({ ...good, readingLevel: 'genius' }, graph)).toThrow();
  });
  it('rifiuta refId inesistente in un action', () => {
    const bad = structuredClone(good);
    (bad.sections[0].content[1] as any).refId = 'block-999';
    expect(() => assertValidUISpec(bad, graph)).toThrow(/block-999/);
  });
  it('rifiuta sourceRef inesistente', () => {
    const bad = structuredClone(good);
    bad.sections[0].sourceRefs = ['block-42'];
    expect(() => assertValidUISpec(bad, graph)).toThrow(/block-42/);
  });
});
