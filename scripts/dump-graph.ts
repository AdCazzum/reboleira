// One-off helper: prints the content graph (block id / type / text) for a mock
// demo page, so fixture authors know which `block-N` ids are real and stable
// for a given page. Mirrors exactly how tests/demo/fixtures.test.ts reduces
// the page to body innerHTML before calling extractContentGraph.
//
// Usage: npx tsx scripts/dump-graph.ts demo/page-a-news.html
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractContentGraph } from '../src/core/content-extractor';
import type { Block } from '../src/core/types';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx scripts/dump-graph.ts <path-to-html>');
  process.exit(1);
}

const html = readFileSync(file, 'utf8');
const bodyHtml = html.replace(/^[\s\S]*?<body[^>]*>|<\/body>[\s\S]*$/g, '');

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const doc = dom.window.document.implementation.createHTMLDocument('t');
doc.body.innerHTML = bodyHtml;

const graph = extractContentGraph(doc);

function describe(b: Block): string {
  switch (b.type) {
    case 'list':
      return (b.items ?? []).join(' | ');
    case 'heading':
      return `(h${b.level}) ${b.text ?? ''}`;
    case 'link':
      return `${b.text ?? ''}  [href=${b.href}]`;
    case 'image':
      return `[src=${b.src}]`;
    default:
      return b.text ?? '';
  }
}

console.log(`# ${file} — ${graph.blocks.length} blocks\n`);
for (const b of graph.blocks) {
  const text = describe(b).replace(/\s+/g, ' ').trim();
  console.log(`${b.id.padEnd(10)} ${b.type.padEnd(10)} ${text.slice(0, 100)}`);
}
