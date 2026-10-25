import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { ICON_PATHS } from '../src/renderer/iconPaths';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : /\.(ts|html|css)$/.test(d.name) ? [p] : [];
  });
}

describe('icons', () => {
  it('has path data for every icon', () => {
    const names = Object.keys(ICON_PATHS);
    assert.ok(names.length >= 35, `only ${names.length} icons`);
    for (const n of names) assert.match(ICON_PATHS[n as keyof typeof ICON_PATHS], /<(path|circle|rect|polyline|line)\b/, n);
  });
  it('the renderer contains no emoji', () => {
    const root = path.join(process.cwd(), 'src', 'renderer');
    for (const f of files(root)) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        assert.ok(!EMOJI.test(line), `${path.relative(root, f)}:${i + 1} contains an emoji`);
      });
    }
  });
});
