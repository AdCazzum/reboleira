import { describe, it, expect } from 'vitest';
import { profileToTheme, themeToCssVars } from '../../src/core/theme';
import type { PersonaProfile } from '../../src/core/types';

const base: PersonaProfile = {
  version: 1, language: 'it', readingLevel: 'simple',
  accessibility: { dyslexiaFriendly: true, highContrast: false, largeText: true, reduceClutter: true },
  expertiseDomains: [], tone: 'plain'
};

describe('profileToTheme', () => {
  it('dislessia -> font dyslexic e lineSpacing ampio', () => {
    const t = profileToTheme(base);
    expect(t.font).toBe('dyslexic');
    expect(t.lineSpacing).toBeGreaterThanOrEqual(1.6);
  });
  it('largeText -> fontScale > 1', () => {
    expect(profileToTheme(base).fontScale).toBeGreaterThan(1);
  });
  it('highContrast -> contrast high', () => {
    const t = profileToTheme({ ...base, accessibility: { ...base.accessibility, highContrast: true } });
    expect(t.contrast).toBe('high');
  });
});
describe('themeToCssVars', () => {
  it('mappa fontScale e lineSpacing su custom properties', () => {
    const vars = themeToCssVars(profileToTheme(base));
    expect(vars['--ens-font-scale']).toBeDefined();
    expect(vars['--ens-line-spacing']).toBeDefined();
  });
});
