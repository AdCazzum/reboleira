// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractContentGraph } from '../../src/core/content-extractor';
import { assertValidUISpec } from '../../src/core/uispec-validate';

const cases = [
  ['a', 'page-a-news.html'], ['b', 'page-b-product.html']
] as const;
const personas = ['personaA','personaB'] as const;

describe('fixtures di fallback', () => {
  for (const [key, file] of cases) for (const persona of personas) {
    it(`uispec-${key}-${persona} è valida contro il content graph di ${file}`, () => {
      const html = readFileSync(`demo/${file}`, 'utf8');
      const doc = document.implementation.createHTMLDocument('t');
      doc.body.innerHTML = html.replace(/^[\s\S]*?<body[^>]*>|<\/body>[\s\S]*$/g, '');
      const graph = extractContentGraph(doc);
      const spec = JSON.parse(readFileSync(`demo/fixtures/uispec-${key}-${persona}.json`, 'utf8'));
      expect(() => assertValidUISpec(spec, graph)).not.toThrow();
    });
  }
});
