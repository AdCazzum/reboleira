import type { PersonaProfile } from '../core/types';
import { extractContentGraph } from '../core/content-extractor';
import { assertValidUISpec } from '../core/uispec-validate';
import { renderUISpec } from '../core/renderer';

export type SpecProvider = (graph: ReturnType<typeof extractContentGraph>, profile: PersonaProfile) => Promise<unknown>;

export async function adaptPage(doc: Document, profile: PersonaProfile, getSpec: SpecProvider): Promise<HTMLElement> {
  const graph = extractContentGraph(doc);
  const raw = await getSpec(graph, profile);
  const spec = assertValidUISpec(raw, graph);
  return renderUISpec(spec, doc);
}
