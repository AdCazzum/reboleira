import type { ContentGraph, PersonaProfile } from './types';
export function buildMessages(graph: ContentGraph, profile: PersonaProfile) {
  const system = [
    'Sei un motore di generative UI. Ricevi il contenuto di una pagina (ContentGraph) e un profilo utente.',
    'Rigenera l\'interfaccia producendo SOLO un JSON conforme allo schema UISpec (nessun testo extra).',
    'Puoi riscrivere/semplificare/tradurre il testo secondo il profilo.',
    'REGOLA FERREA: ogni refId e sourceRef DEVE essere un id esistente nel ContentGraph (only existing block ids). Non inventare link/azioni.'
  ].join(' ');
  const user = `PROFILE=${JSON.stringify(profile)}\nCONTENT_GRAPH=${JSON.stringify(graph)}`;
  return { system, user };
}
