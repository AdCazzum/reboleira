import type { UISpec, UISection, UIContentItem } from './types';
import { themeToCssVars } from './theme';

function renderItem(doc: Document, item: UIContentItem): Node {
  if (item.type === 'text') { const p = doc.createElement('p'); p.textContent = item.text; return p; }
  if (item.type === 'list') {
    const ul = doc.createElement('ul');
    item.items.forEach(t => { const li = doc.createElement('li'); li.textContent = t; ul.appendChild(li); });
    return ul;
  }
  if (item.type === 'image') {
    const orig = doc.querySelector<HTMLImageElement>(`[data-ensight-id="${item.refId}"]`);
    const img = doc.createElement('img');
    if (orig) { img.src = orig.src; img.alt = orig.alt; }
    return img;
  }
  // action
  const btn = doc.createElement('button');
  btn.textContent = item.label;
  btn.dataset.ref = item.refId;
  btn.addEventListener('click', () => {
    doc.querySelector<HTMLElement>(`[data-ensight-id="${item.refId}"]`)?.click();
  });
  return btn;
}

function renderSection(doc: Document, s: UISection): HTMLElement {
  const sec = doc.createElement('section');
  sec.dataset.role = s.role;
  if (s.heading) { const h = doc.createElement('h2'); h.textContent = s.heading; sec.appendChild(h); }
  s.content.forEach(c => sec.appendChild(renderItem(doc, c)));
  return sec;
}

export function renderUISpec(spec: UISpec, doc: Document): HTMLElement {
  const root = doc.createElement('div');
  root.id = 'ensight-root';
  const shadow = root.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  const vars = Object.entries(themeToCssVars(spec.theme)).map(([k,v]) => `${k}:${v}`).join(';');
  style.textContent = `:host{all:initial;${vars};display:block;font-family:var(--ens-font-family);
    color:var(--ens-fg);background:var(--ens-bg);font-size:calc(1rem*var(--ens-font-scale));
    line-height:var(--ens-line-spacing);padding:2rem;}
    section{margin-bottom:var(--ens-gap);} button{font:inherit;padding:.6em 1em;cursor:pointer;}`;
  shadow.appendChild(style);
  [...spec.sections].filter(s => s.role !== 'hidden')
    .sort((a,b) => a.priority - b.priority)
    .forEach(s => shadow.appendChild(renderSection(doc, s)));
  return root;
}
