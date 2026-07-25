import type { ContentGraph, PersonaProfile, UISpec } from '../core/types';
import { buildMessages } from '../core/prompt';
import { assertValidUISpec } from '../core/uispec-validate';

export interface Broker { chat(messages: { system: string; user: string }): Promise<string>; }

function extractJson(s: string): unknown {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{'); const end = body.lastIndexOf('}');
  return JSON.parse(body.slice(start, end + 1));
}
export async function requestUISpec(graph: ContentGraph, profile: PersonaProfile, broker: Broker): Promise<UISpec> {
  const raw = await broker.chat(buildMessages(graph, profile));
  return assertValidUISpec(extractJson(raw), graph);
}
