import type { Block, BlockType, ContentGraph } from './types';

const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG']);

function classify(el: Element): { type: BlockType; extra: Partial<Block> } | null {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) return { type: 'heading', extra: { level: +tag[1] } };
  if (tag === 'P') return { type: 'paragraph', extra: {} };
  if (tag === 'UL' || tag === 'OL')
    return { type: 'list', extra: { items: [...el.querySelectorAll('li')].map(li => li.textContent!.trim()).filter(Boolean) } };
  if (tag === 'BUTTON' || (tag === 'INPUT' && (el as HTMLInputElement).type === 'submit'))
    return { type: 'action', extra: {} };
  if (tag === 'A') return { type: 'link', extra: { href: (el as HTMLAnchorElement).getAttribute('href') ?? '' } };
  if (tag === 'IMG') return { type: 'image', extra: { src: (el as HTMLImageElement).getAttribute('src') ?? '' } };
  if (tag === 'NAV') return { type: 'nav', extra: {} };
  if (tag === 'FORM') return { type: 'form', extra: {} };
  return null;
}

export function extractContentGraph(doc: Document): ContentGraph {
  const blocks: Block[] = [];
  let n = 0;
  const walk = (el: Element) => {
    if (SKIP.has(el.tagName)) return;
    const c = classify(el);
    if (c) {
      const text = c.type === 'list' ? undefined : (el.textContent ?? '').trim();
      if (c.type === 'list' || c.type === 'image' || (text && text.length)) {
        const id = `block-${n++}`;
        (el as HTMLElement).dataset.ensightId = id;
        blocks.push({ id, type: c.type, ...(text ? { text } : {}), ...c.extra });
        return; // non ridiscendere dentro un blocco già catturato
      }
    }
    for (const child of el.children) walk(child);
  };
  walk(doc.body);
  return { url: doc.location?.href ?? '', title: doc.title, blocks };
}
