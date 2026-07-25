// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { adaptPage } from '../../src/content/adapt';
import type { PersonaProfile } from '../../src/core/types';

const profile: PersonaProfile = { version:1, language:'it', readingLevel:'simple',
  accessibility:{dyslexiaFriendly:true,highContrast:false,largeText:true,reduceClutter:true},
  expertiseDomains:[], tone:'plain' };

const validSpec = { theme:{fontScale:1,contrast:'normal',font:'system',lineSpacing:1.4,colorMode:'auto',density:'comfortable'},
  language:'it', readingLevel:'simple', hidden:[], sections:[{role:'primary',priority:1,content:[{type:'text',text:'ok'}],sourceRefs:[]}] };

describe('adaptPage', () => {
  it('rende la spec fornita da getSpec', async () => {
    document.body.innerHTML = '<p>orig</p>';
    const root = await adaptPage(document, profile, async () => validSpec);
    expect(root.shadowRoot!.textContent).toContain('ok');
  });
  it('propaga l\'errore se getSpec fallisce (il chiamante deciderà il fallback)', async () => {
    document.body.innerHTML = '<p>orig</p>';
    await expect(adaptPage(document, profile, async () => { throw new Error('rete'); })).rejects.toThrow('rete');
  });
});
