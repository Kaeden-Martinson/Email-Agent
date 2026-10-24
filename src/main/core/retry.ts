// Polite retries for mail-provider APIs: back off on rate limits (429) and transient server errors,
// honouring Retry-After, without hammering the provider or hanging forever.

export interface RetryOptions {
  retries?: number;
  /** Longest single wait. */
  maxDelayMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; 0..1. */
  random?: () => number;
}

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Retry-After as seconds or an HTTP date; undefined when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  if (/^\d+(\.\d+)?$/.test(header.trim())) return Math.round(Number(header) * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

export function backoffMs(attempt: number, random: () => number, maxDelayMs: number): number {
  // 0.5s, 1s, 2s, 4s… with jitter so many clients don't retry in lockstep.
  return Math.min(maxDelayMs, 500 * 2 ** attempt * (0.75 + random() * 0.5));
}

/**
 * Calls `attempt` and retries on network failures and transient HTTP statuses. Non-transient
 * responses (including 4xx errors other than 408/425/429) are returned to the caller as-is.
 */
export async function withRetry(attempt: () => Promise<Response>, opts: RetryOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 3;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  for (let i = 0; ; i++) {
    let res: Response | undefined;
    try {
      res = await attempt();
    } catch (e) {
      if (i >= retries) throw e;
      await sleep(backoffMs(i, random, maxDelayMs));
      continue;
    }
    if (!TRANSIENT.has(res.status) || i >= retries) return res;
    const wait = retryAfterMs(res.headers.get('retry-after')) ?? backoffMs(i, random, maxDelayMs);
    await sleep(Math.min(wait, maxDelayMs));
  }
}
