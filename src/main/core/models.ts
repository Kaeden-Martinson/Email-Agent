// Choosing a local model: which installed model to use, and what to fall back to when one won't load.

/** General chat models known to follow JSON schemas well, best first. */
const PREFERRED = [/^qwen2\.5/, /^llama3\.[123]/, /^gemma3/, /^mistral/, /^phi[34]/, /^qwen3/, /^gemma/, /^llama/];

/** Embedding models and special-purpose fine-tunes aren't suitable for reading email. */
const UNSUITABLE = /embed|bge|minilm|rerank|editor|coder|vision|whisper|tts/i;

/**
 * The best installed chat model that isn't known to fail, or undefined.
 * `failed` holds models that couldn't be loaded in this session.
 */
export function pickModel(installed: readonly string[], failed: ReadonlySet<string> = new Set()): string | undefined {
  const usable = installed.filter((m) => !failed.has(m) && !UNSUITABLE.test(m));
  for (const re of PREFERRED) {
    const hit = usable.find((m) => re.test(m));
    if (hit) return hit;
  }
  return usable[0];
}
