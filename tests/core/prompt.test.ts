import { describe, it, expect } from 'vitest';
import { buildMessages } from '../../src/core/prompt';
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
});
