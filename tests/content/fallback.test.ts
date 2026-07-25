// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { withFallback } from '../../src/content/content-script-helpers';
describe('withFallback', () => {
  it('usa il fallback se il primario rigetta', async () => {
    const r = await withFallback(async () => { throw new Error('x'); }, async () => ({ ok: true }));
    expect(r).toEqual({ ok: true });
  });
  it('usa il primario se ha successo', async () => {
    const r = await withFallback(async () => ({ primary: true }), async () => ({ ok: true }));
    expect(r).toEqual({ primary: true });
  });
});
