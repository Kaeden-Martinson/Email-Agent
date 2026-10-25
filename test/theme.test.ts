import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveTheme, THEME_BG } from '../src/shared/theme';

describe('theme', () => {
  it('uses the explicit choice', () => {
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
  });
  it('follows Windows for system, and for missing or unknown values', () => {
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('system', false), 'light');
    assert.equal(resolveTheme(undefined, true), 'dark');
    assert.equal(resolveTheme('purple' as never, false), 'light');
  });
  it('has the Graphite window backgrounds', () => {
    assert.deepEqual(THEME_BG, { light: '#fbfbfc', dark: '#0e0f12' });
  });
});
