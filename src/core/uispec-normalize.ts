// Riconciliazione dell'output del modello con lo schema UISpec.
//
// Il modello di inferenza su 0G Compute è un 7B: rispetta la forma generale ma
// deriva sul vocabolario, tipicamente dopo le prime sezioni — `type: "paragraph"`
// invece di `"text"`, `"bullet_list"` invece di `"list"`, `role: "main"` invece
// di `"primary"`, numeri come stringhe. Lo schema è una unione discriminata su
// `type`, quindi una singola deviazione fa fallire `parse()` e l'intera UI
// generata viene buttata in favore della fixture pre-calcolata.
//
// La coercizione qui è deliberatamente guidata dalla FORMA, non dai nomi: invece
// di indovinare la lista dei sinonimi che il modello potrebbe inventare, si
// guarda quali campi porta l'item (`text`, `items`, `refId`+`label`, `refId`) e
// si ricostruisce la variante corrispondente. Regge anche i nomi che non abbiamo
// previsto.
//
// Cosa NON fa, di proposito: non tocca i `refId`. Sono la garanzia
// anti-allucinazione del prodotto — nessun link o azione che non esista già
// nella pagina — e restano affidati a validateRefs(), che rifiuta lo spec se il
// modello se li è inventati. Normalizzare la forma non deve mai diventare
// inventare contenuto.
import type { ContentGraph } from './types';

const ROLES = ['primary', 'summary', 'content', 'actions', 'navigation', 'aside', 'hidden'] as const;
const READING_LEVELS = ['simple', 'standard', 'expert'] as const;

// Sinonimi HTML/semantici che un modello usa naturalmente al posto dei nostri
// role. Tutto ciò che non è qui ricade su "content": un role neutro che viene
// comunque reso, così una parola inattesa non fa sparire del contenuto (a
// differenza di "hidden", che lo nasconderebbe).
const ROLE_SYNONYMS: Record<string, (typeof ROLES)[number]> = {
  main: 'primary', article: 'primary', hero: 'primary', banner: 'primary',
  abstract: 'summary', summary_section: 'summary', tldr: 'summary',
  body: 'content', text: 'content', section: 'content', details: 'content',
  cta: 'actions', buttons: 'actions', links: 'actions',
  nav: 'navigation', menu: 'navigation', breadcrumb: 'navigation',
  sidebar: 'aside', complementary: 'aside', related: 'aside', footer: 'aside',
  hide: 'hidden', removed: 'hidden', dropped: 'hidden'
};

type Item = Record<string, unknown>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Primo dei campi indicati che porti una stringa. */
function firstStringOf(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) if (typeof o[k] === 'string') return o[k] as string;
  return undefined;
}

function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Ricostruisce un content item nella variante che la sua forma suggerisce.
 * Restituisce null se non c'è nulla di renderizzabile: l'item viene scartato,
 * che è meglio che perdere l'intero spec generato.
 */
function normalizeItem(raw: unknown): Item | null {
  if (typeof raw === 'string') {
    return raw.trim() ? { type: 'text', text: raw } : null;
  }
  if (!isObject(raw)) return null;

  const refId = firstStringOf(raw, 'refId', 'ref');
  const label = firstStringOf(raw, 'label');
  const text = firstStringOf(raw, 'text', 'content', 'value', 'title');
  const items = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.list) ? raw.list : undefined;

  // L'ordine conta: un'azione porta refId E label, un'immagine solo refId.
  if (refId && label) return { type: 'action', refId, label };
  if (refId && raw.type === 'action') return { type: 'action', refId, label: text ?? refId };
  if (refId) return { type: 'image', refId };
  if (items) {
    // Le voci possono arrivare come oggetti ({ text: "..." }) invece che come
    // stringhe: String(oggetto) darebbe "[object Object]" a schermo.
    const flat = items
      .map(v => (typeof v === 'string' ? v : isObject(v) ? (firstStringOf(v, 'text', 'label', 'value', 'title') ?? '') : String(v)))
      .filter(s => s.trim());
    return flat.length ? { type: 'list', items: flat } : null;
  }
  if (text?.trim()) return { type: 'text', text };
  if (label?.trim()) return { type: 'text', text: label };
  return null;
}

function normalizeRole(raw: unknown): (typeof ROLES)[number] {
  const key = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((ROLES as readonly string[]).includes(key)) return key as (typeof ROLES)[number];
  return ROLE_SYNONYMS[key] ?? 'content';
}

function normalizeSection(raw: unknown, index: number): Record<string, unknown> | null {
  if (!isObject(raw)) return null;
  const content = (Array.isArray(raw.content) ? raw.content : [])
    .map(normalizeItem)
    .filter((i): i is Item => i !== null);

  const section: Record<string, unknown> = {
    role: normalizeRole(raw.role),
    priority: asNumber(raw.priority, index + 1),
    content,
    sourceRefs: (Array.isArray(raw.sourceRefs) ? raw.sourceRefs : []).filter((r): r is string => typeof r === 'string')
  };
  if (typeof raw.heading === 'string') section.heading = raw.heading;
  return section;
}

function normalizeTheme(raw: unknown): Record<string, unknown> {
  const t = isObject(raw) ? raw : {};
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    (allowed as readonly string[]).includes(String(v)) ? (String(v) as T) : fallback;
  return {
    fontScale: clamp(asNumber(t.fontScale, 1), 0.5, 3),
    contrast: oneOf(t.contrast, ['normal', 'high'] as const, 'normal'),
    font: oneOf(t.font, ['system', 'dyslexic', 'serif'] as const, 'system'),
    lineSpacing: clamp(asNumber(t.lineSpacing, 1.5), 1, 3),
    colorMode: oneOf(t.colorMode, ['light', 'dark', 'auto'] as const, 'light'),
    density: oneOf(t.density, ['comfortable', 'compact'] as const, 'comfortable')
  };
}

/**
 * Riconduce l'output del modello alla forma dello schema. Non valida: il
 * risultato va comunque passato ad assertValidUISpec, che resta l'unica autorità
 * (schema + esistenza dei refId).
 *
 * `graph` è accettato per simmetria con assertValidUISpec e per usi futuri
 * (es. scartare i refId inesistenti invece di far fallire lo spec); oggi non
 * viene usato, perché la verifica dei refId è deliberatamente lasciata alla
 * validazione.
 */
export function normalizeUISpec(raw: unknown, _graph?: ContentGraph): unknown {
  if (!isObject(raw)) return raw;

  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map(normalizeSection)
    .filter((s): s is Record<string, unknown> => s !== null);

  return {
    theme: normalizeTheme(raw.theme),
    language: typeof raw.language === 'string' ? raw.language : 'en',
    readingLevel: (READING_LEVELS as readonly string[]).includes(String(raw.readingLevel))
      ? raw.readingLevel
      : 'standard',
    sections,
    hidden: (Array.isArray(raw.hidden) ? raw.hidden : []).filter((h): h is string => typeof h === 'string')
  };
}
