import { uiSpecSchema } from './uispec-schema';
import type { ContentGraph, UISpec } from './types';

export function parseUISpec(raw: unknown): UISpec {
  return uiSpecSchema.parse(raw) as UISpec;
}
export function validateRefs(spec: UISpec, graph: ContentGraph): void {
  const known = new Set(graph.blocks.map(b => b.id));
  const check = (id: string) => { if (!known.has(id)) throw new Error(`refId sconosciuto: ${id}`); };
  for (const s of spec.sections) {
    s.sourceRefs.forEach(check);
    for (const c of s.content) if ('refId' in c) check(c.refId);
  }
  spec.hidden.forEach(check);
}
export function assertValidUISpec(raw: unknown, graph: ContentGraph): UISpec {
  const spec = parseUISpec(raw);
  validateRefs(spec, graph);
  return spec;
}
