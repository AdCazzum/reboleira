import { describe, it, expect } from 'vitest';
import { buildMessages, UISPEC_EXAMPLE } from '../../src/core/prompt';
import { uiSpecSchema } from '../../src/core/uispec-schema';
const graph = { url:'u', title:'T', blocks:[{id:'block-0',type:'action',text:'Buy'}] } as any;
const profile = { version:1, language:'it', readingLevel:'simple', accessibility:{dyslexiaFriendly:true,highContrast:false,largeText:true,reduceClutter:true}, expertiseDomains:[], tone:'plain' } as any;
describe('buildMessages', () => {
  it('include profilo, block id e istruzione JSON-only', () => {
    const { system, user } = buildMessages(graph, profile);
    expect(system).toMatch(/JSON/i);
    expect(user).toContain('block-0');
    expect(user).toContain('"language":"it"');
  });
  it('vincola i refId agli id presenti nel graph', () => {
    expect(buildMessages(graph, profile).system).toMatch(/refId.*esist|only.*existing/i);
  });
  it('mostra esplicitamente i campi chiave dello schema UISpec (sections/theme/hidden)', () => {
    const { system } = buildMessages(graph, profile);
    expect(system).toContain('sections');
    expect(system).toContain('theme');
    expect(system).toContain('hidden');
  });
  it('impone UN SOLO oggetto JSON in output (guardia contro risposte multi-oggetto)', () => {
    const { system } = buildMessages(graph, profile);
    expect(system).toMatch(/exactly one|only one/i);
  });
  it('include un esempio di UISpec completo, valido secondo lo zod schema reale', () => {
    const parsed = JSON.parse(UISPEC_EXAMPLE);
    const result = uiSpecSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });
});
