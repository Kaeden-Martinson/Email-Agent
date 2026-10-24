/** Thrown when Ollama is down or the model is missing: stop the batch and retry next sync. */
export class OllamaUnavailableError extends Error {}

async function call<T>(baseUrl: string, path: string, init?: RequestInit, model?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(300_000) });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new Error('Ollama took more than 5 minutes to answer.');
    throw new OllamaUnavailableError(`Can't reach Ollama at ${baseUrl}. Is it running?`);
  }
  if (res.status === 404 && model) {
    throw new OllamaUnavailableError(`Model "${model}" isn't installed. Run: ollama pull ${model}`);
  }
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
