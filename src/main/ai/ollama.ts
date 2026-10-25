/** Thrown when Ollama is down or the model is missing: stop the batch and retry next sync. */
export class OllamaUnavailableError extends Error {}

/** The model is installed but Ollama can't load it (incompatible build, not enough memory…). */
export class ModelLoadError extends OllamaUnavailableError {
  constructor(
    readonly model: string,
    detail: string,
  ) {
    super(`Ollama couldn't load the model "${model}": ${detail}`);
  }
}

async function call<T>(baseUrl: string, path: string, init?: RequestInit, model?: string, timeoutMs = 300_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') {
      if (timeoutMs < 300_000 && model) throw new ModelLoadError(model, `no answer within ${Math.round(timeoutMs / 1000)} seconds`);
      throw new Error('Ollama took more than 5 minutes to answer.');
    }
    throw new OllamaUnavailableError(`Can't reach Ollama at ${baseUrl}. Is it running?`);
  }
  if (res.status === 404 && model) {
    throw new OllamaUnavailableError(`Model "${model}" isn't installed. Run: ollama pull ${model}`);
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    if (model && res.status >= 500 && /llama-server|error loading model|failed to (?:load|initialize)|unable to load|out of memory/i.test(text)) {
      throw new ModelLoadError(model, text.replace(/^\{"error":"|"\}$/g, '').slice(0, 160));
    }
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Local embeddings (needs an embedding model such as nomic-embed-text). */
export async function embed(baseUrl: string, model: string, input: string[]): Promise<number[][]> {
  const res = await call<{ embeddings: number[][] }>(
    baseUrl,
    '/api/embed',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }) },
    model,
  );
  return res.embeddings;
}

/** Downloads a model into the local Ollama. Only called after the user confirms in the UI. */
export async function pullModel(baseUrl: string, model: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(new URL('/api/pull', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false }),
      signal: AbortSignal.timeout(30 * 60_000),
    });
  } catch {
    throw new OllamaUnavailableError(`Can't reach Ollama at ${baseUrl}. Is it running?`);
  }
  const json = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
  if (!res.ok || json.error) throw new Error(`Couldn't download ${model}: ${json.error ?? res.status}`);
}

/**
 * One tiny structured request with the same settings as real work (so the model isn't reloaded after).
 * An empty "load" isn't enough: some models load but then hang or fail on the first real request.
 * Throws ModelLoadError if it fails to load or doesn't answer within `timeoutMs`.
 */
export async function probeModel(baseUrl: string, model: string, timeoutMs = 120_000): Promise<void> {
  const res = await call<{ message?: { content?: string } }>(
    baseUrl,
    '/api/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
        options: { temperature: 0, num_ctx: 8192, num_predict: 16 },
        messages: [{ role: 'user', content: 'Reply with {"ok": true}' }],
      }),
    },
    model,
    timeoutMs,
  );
  if (!res.message?.content) throw new ModelLoadError(model, 'empty answer');
}

export async function listModels(baseUrl: string): Promise<string[]> {
  const res = await call<{ models: { name: string }[] }>(baseUrl, '/api/tags');
  return res.models.map((m) => m.name).sort();
}

/** One chat turn constrained to a JSON schema (Ollama structured outputs). */
export async function chatJson<T>(
  baseUrl: string,
  model: string,
  system: string,
  user: string,
  schema: object,
  opts: { numCtx?: number } = {},
): Promise<T> {
  const res = await call<{ message: { content: string } }>(
    baseUrl,
    '/api/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: schema,
        options: { temperature: 0.2, num_ctx: opts.numCtx ?? 8192 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    },
    model,
  );
  try {
    return JSON.parse(res.message.content) as T;
  } catch {
    throw new Error('The model returned something that is not valid JSON.');
  }
}
