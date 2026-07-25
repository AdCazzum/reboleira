import { describe, it, expect } from 'vitest';
import { requestUISpec } from '../../src/services/zerog-compute';
const graph = { url:'', title:'t', blocks:[{id:'block-0',type:'heading',text:'H',level:1}] } as any;
const profile = { version:1, language:'it', readingLevel:'simple', accessibility:{dyslexiaFriendly:false,highContrast:false,largeText:false,reduceClutter:false}, expertiseDomains:[], tone:'neutral' } as any;
const validJson = JSON.stringify({ theme:{fontScale:1,contrast:'normal',font:'system',lineSpacing:1.4,colorMode:'auto',density:'comfortable'}, language:'it', readingLevel:'simple', hidden:[], sections:[{role:'primary',priority:1,content:[{type:'text',text:'ciao'}],sourceRefs:['block-0']}] });

describe('requestUISpec', () => {
  it('parsa e valida la risposta del broker', async () => {
    const spec = await requestUISpec(graph, profile, { chat: async () => validJson });
    expect(spec.sections[0].content[0]).toMatchObject({ type:'text', text:'ciao' });
  });
  it('estrae il JSON anche se avvolto in ```json fences', async () => {
    const spec = await requestUISpec(graph, profile, { chat: async () => '```json\n'+validJson+'\n```' });
    expect(spec.language).toBe('it');
  });
  it('rilancia su JSON non valido', async () => {
    await expect(requestUISpec(graph, profile, { chat: async () => 'non-json' })).rejects.toBeDefined();
  });
});
