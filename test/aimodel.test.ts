import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installedChoice, recommendModel } from '../src/main/core/aimodel';

describe('choosing a model for the PC', () => {
  it('uses the 7B model with a 6 GB+ graphics card or 16 GB RAM', () => {
    assert.equal(recommendModel(8, 8).model, 'qwen2.5:7b');
    assert.equal(recommendModel(15.8).model, 'qwen2.5:7b'); // "16 GB" PCs report a little less
  });
  it('steps down on smaller PCs and says why', () => {
    const mid = recommendModel(8);
    assert.equal(mid.model, 'qwen2.5:3b');
    assert.match(mid.note!, /smaller model/);
    assert.equal(recommendModel(4).model, 'qwen2.5:1.5b');
  });
  it('uses the recommended model if installed, else the best installed one', () => {
    assert.equal(installedChoice(['qwen2.5:7b', 'llama3.1:8b'], 'qwen2.5:3b'), 'qwen2.5:7b');
    assert.equal(installedChoice(['qwen2.5:3b'], 'qwen2.5:3b'), 'qwen2.5:3b');
    assert.equal(installedChoice(['nomic-embed-text:latest'], 'qwen2.5:7b'), undefined);
  });
});
