// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderUISpec } from '../../src/core/renderer';
import type { UISpec } from '../../src/core/types';

const theme = { fontScale:1, contrast:'normal', font:'system', lineSpacing:1.4, colorMode:'auto', density:'comfortable' } as const;

function specWithAction(): UISpec {
  return { theme, language:'it', readingLevel:'standard', hidden:[], sections:[
    { role:'primary', priority:2, heading:'Sotto', content:[{type:'text',text:'B'}], sourceRefs:[] },
    { role:'actions', priority:1, content:[{type:'action',refId:'block-1',label:'Compra ora'}], sourceRefs:[] },
  ]};
}

describe('renderUISpec', () => {
  it('ordina le sezioni per priority crescente', () => {
    document.body.innerHTML = '<button data-ensight-id="block-1">orig</button>';
    const root = renderUISpec(specWithAction(), document);
    const headings = root.shadowRoot!.querySelectorAll('[data-role]');
    expect((headings[0] as HTMLElement).dataset.role).toBe('actions');
  });
  it('un click sull\'azione generata attiva il click sull\'originale', () => {
    document.body.innerHTML = '<button data-ensight-id="block-1">orig</button>';
    const spy = vi.fn();
    document.querySelector('button')!.addEventListener('click', spy);
    const root = renderUISpec(specWithAction(), document);
    (root.shadowRoot!.querySelector('button[data-ref="block-1"]') as HTMLElement).click();
    expect(spy).toHaveBeenCalledOnce();
  });
  it('usa il testo riscritto dalla spec, non quello originale', () => {
    document.body.innerHTML = '<button data-ensight-id="block-1">orig</button>';
    const root = renderUISpec(specWithAction(), document);
    expect(root.shadowRoot!.textContent).toContain('Compra ora');
    expect(root.shadowRoot!.textContent).not.toContain('orig');
  });
});
