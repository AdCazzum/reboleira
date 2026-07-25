import uispecAPersonaA from './uispec-a-personaA.json';
import uispecAPersonaB from './uispec-a-personaB.json';
import uispecBPersonaA from './uispec-b-personaA.json';
import uispecBPersonaB from './uispec-b-personaB.json';

export type PersonaKey = 'personaA' | 'personaB';

const fixtures: Record<'a' | 'b', Record<PersonaKey, unknown>> = {
  a: { personaA: uispecAPersonaA, personaB: uispecAPersonaB },
  b: { personaA: uispecBPersonaA, personaB: uispecBPersonaB }
};

/**
 * Restituisce la fixture UISpec pre-calcolata corrispondente alla pagina (dedotta
 * dall'URL/pathname, cercando "page-a" / "page-b") e alla persona attiva.
 */
export function fixtureFor(url: string, persona: PersonaKey): unknown {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // url non assoluto (es. già un pathname o una stringa di test): usalo così com'è
  }
  const page: 'a' | 'b' | undefined = pathname.includes('page-a') ? 'a' : pathname.includes('page-b') ? 'b' : undefined;
  if (!page) throw new Error(`fixtureFor: nessuna fixture demo per l'URL ${url}`);
  return fixtures[page][persona];
}
