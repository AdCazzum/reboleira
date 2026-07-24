export type BlockType = 'heading'|'paragraph'|'list'|'image'|'link'|'action'|'form'|'nav';

export interface Block {
  id: string;                 // "block-12", stabile nella singola estrazione
  type: BlockType;
  text?: string;              // testo visibile (heading/paragraph/link/action label)
  items?: string[];           // per list
  href?: string;              // per link
  src?: string;               // per image
  level?: number;             // per heading 1-6
}
export interface ContentGraph { url: string; title: string; blocks: Block[]; }

export interface PersonaProfile {
  version: 1;
  language: string;                                   // BCP-47, es "it"
  readingLevel: 'simple'|'standard'|'expert';
  accessibility: { dyslexiaFriendly: boolean; highContrast: boolean; largeText: boolean; reduceClutter: boolean; };
  expertiseDomains: string[];
  tone: 'plain'|'neutral'|'technical';
}

export interface UITheme {
  fontScale: number; contrast: 'normal'|'high'; font: 'system'|'dyslexic'|'serif';
  lineSpacing: number; colorMode: 'light'|'dark'|'auto'; density: 'comfortable'|'compact';
}
export type UIContentItem =
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'image'; refId: string }
  | { type: 'action'; refId: string; label: string };
export interface UISection {
  role: 'primary'|'summary'|'content'|'actions'|'navigation'|'aside'|'hidden';
  priority: number; heading?: string; content: UIContentItem[]; sourceRefs: string[];
}
export interface UISpec {
  theme: UITheme; language: string; readingLevel: 'simple'|'standard'|'expert';
  sections: UISection[]; hidden: string[];
}
