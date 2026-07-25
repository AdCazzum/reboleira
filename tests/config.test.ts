import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';

describe('CONFIG', () => {
  it('uses the exact ENS record keys', () => {
    expect(CONFIG.recordKeys.profile).toBe('app.ensight.profile');
    expect(CONFIG.recordKeys.human).toBe('app.ensight.human');
  });

  it('targets the 0G chain id', () => {
    expect(CONFIG.zerogChainId).toBe(16601);
  });
});
