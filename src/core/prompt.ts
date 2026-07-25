import type { Block, ContentGraph, PersonaProfile } from './types';

// Esempio minimo ma COMPLETO di UISpec valido (illustrativo: gli id "block-N" qui sono
// puramente esemplificativi, il modello deve sempre usare gli id reali del CONTENT_GRAPH
// fornito nel messaggio utente). Deve restare sincronizzato con src/core/types.ts e
// validare contro src/core/uispec-schema.ts (vedi tests/core/prompt.test.ts).
export const UISPEC_EXAMPLE = [
  '{',
  '  "theme": { "fontScale": 1.2, "contrast": "high", "font": "dyslexic", "lineSpacing": 1.5, "colorMode": "light", "density": "comfortable" },',
  '  "language": "it",',
  '  "readingLevel": "simple",',
  '  "sections": [',
  '    {',
  '      "role": "primary",',
  '      "priority": 1,',
  '      "heading": "Benvenuto",',
  '      "content": [',
  '        { "type": "text", "text": "Benvenuto su ENSight" },',
  '        { "type": "action", "refId": "block-1", "label": "Iscriviti alla newsletter" }',
  '      ],',
  '      "sourceRefs": ["block-0", "block-1"]',
  '    },',
  '    {',
  '      "role": "aside",',
  '      "priority": 2,',
  '      "content": [',
  '        { "type": "list", "items": ["Punto 1", "Punto 2"] }',
  '      ],',
  '      "sourceRefs": ["block-2"]',
  '    }',
  '  ],',
  '  "hidden": ["block-3"]',
  '}'
].join('\n');

function buildSystemPrompt(): string {
  const role =
    "You are ENSight's generative-UI engine. You receive a page's content as a CONTENT_GRAPH " +
    'and a user PROFILE. Your job is to output a single UISpec JSON object that reorganizes and ' +
    'adapts that content for this specific user.';

  const shape = [
    'The UISpec object has EXACTLY these top-level keys:',
    '- `theme`: { fontScale: number (0.5-3), contrast: "normal"|"high", font: "system"|"dyslexic"|"serif", lineSpacing: number (1-3), colorMode: "light"|"dark"|"auto", density: "comfortable"|"compact" }',
    '- `language`: BCP-47 string (e.g. "it")',
    '- `readingLevel`: "simple"|"standard"|"expert"',
    '- `sections`: array of { role: "primary"|"summary"|"content"|"actions"|"navigation"|"aside"|"hidden", priority: number, heading?: string, content: array of content items, sourceRefs: array of block ids }',
    '- `hidden`: array of block ids that were dropped/hidden from view',
    '',
    "Each item in a section's `content` array must be EXACTLY one of these four shapes:",
    '- { "type": "text", "text": string }',
    '- { "type": "list", "items": string[] }',
    '- { "type": "image", "refId": BLOCK_ID }',
    '- { "type": "action", "refId": BLOCK_ID, "label": string }',
    '`refId` appears ONLY on `image` and `action` items — never on `text` or `list` items.'
  ].join('\n');

  const example = [
    'EXAMPLE of one complete, valid UISpec (the block ids below are illustrative only — ' +
      'always replace them with the real ids from CONTENT_GRAPH.blocks given in the user message):',
    UISPEC_EXAMPLE
  ].join('\n');

  const rules = [
    'HARD RULES — follow all of them exactly:',
    '1. Output EXACTLY ONE JSON object with the UISpec shape above. Nothing else: no prose, no markdown code fences, no multiple objects, no trailing text before or after it.',
    '2. Every `refId`, every entry in `sourceRefs`, and every entry in `hidden` MUST be an id that already exists in CONTENT_GRAPH.blocks — use only existing block ids, never invent ids, links, or actions.',
    '3. You may rewrite, simplify, or translate the visible text according to the profile, but every action/link must still originate from a real block.',
    '4. Pick `theme` values inside the stated ranges/enums, chosen to match the profile\'s accessibility settings and reading level (e.g. highContrast -> contrast:"high", dyslexiaFriendly -> font:"dyslexic", largeText -> higher fontScale).'
  ].join('\n');

  return [role, shape, example, rules].join('\n\n');
}

function formatBlockLine(block: Block): string {
  const label =
    block.text ??
    (block.items && block.items.length ? block.items.join(', ') : undefined) ??
    block.href ??
    block.src ??
    '';
  return `${block.id} (${block.type}): ${label}`;
}

function buildUserPrompt(graph: ContentGraph, profile: PersonaProfile): string {
  const blocksList = graph.blocks.map(formatBlockLine).join('\n');
  return [
    `PROFILE=${JSON.stringify(profile)}`,
    `CONTENT_GRAPH=${JSON.stringify(graph)}`,
    'AVAILABLE_BLOCKS (id (type): text — use ONLY these ids for refId/sourceRefs/hidden):',
    blocksList
  ].join('\n');
}

export function buildMessages(graph: ContentGraph, profile: PersonaProfile) {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(graph, profile);
  return { system, user };
}
