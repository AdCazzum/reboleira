import type { PersonaProfile, UITheme } from './types';
export function profileToTheme(p: PersonaProfile): UITheme {
  const a = p.accessibility;
  return {
    fontScale: a.largeText ? 1.35 : 1,
    contrast: a.highContrast ? 'high' : 'normal',
    font: a.dyslexiaFriendly ? 'dyslexic' : 'system',
    lineSpacing: a.dyslexiaFriendly ? 1.8 : 1.4,
    colorMode: 'auto',
    density: a.reduceClutter ? 'comfortable' : 'compact'
  };
}
export function themeToCssVars(t: UITheme): Record<string,string> {
  const fontFamily = t.font === 'dyslexic'
    ? 'OpenDyslexic, "Comic Sans MS", sans-serif'
    : t.font === 'serif' ? 'Georgia, serif' : 'system-ui, sans-serif';
  return {
    '--ens-font-scale': String(t.fontScale),
    '--ens-line-spacing': String(t.lineSpacing),
    '--ens-font-family': fontFamily,
    '--ens-fg': t.contrast === 'high' ? '#000' : '#1a1a1a',
    '--ens-bg': t.contrast === 'high' ? '#fff' : '#fafafa',
    '--ens-gap': t.density === 'comfortable' ? '1.5rem' : '0.75rem'
  };
}
