// Grounded answers: number the retrieved sources for the model, then check what it returns so every
// citation points at a real source and an uncited "answer" is never presented as verified.

export interface Source {
  n: number;
  kind: 'email' | 'item' | 'commitment';
  key?: string;
  title: string;
  from: string;
  at: number;
  text: string;
}

export function formatSources(sources: readonly Source[]): string {
  return sources
    .map((s) => {
      const label = s.kind === 'email' ? 'Email' : s.kind === 'item' ? 'Tracked date' : 'Your commitment';
      const when = new Date(s.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      return `[${s.n}] ${label} · ${when} · from ${s.from} · "${s.title}"\n${s.text}`;
    })
    .join('\n\n');
}

export interface CleanAnswer {
  answer: string;
  found: boolean;
  citations: number[];
  /** Found, and backed by at least one real citation. */
  verified: boolean;
}

/** Keeps only citations that exist, strips markers that point nowhere, and flags uncited answers. */
export function cleanAnswer(raw: { answer?: unknown; found?: unknown; citations?: unknown }, sourceCount: number): CleanAnswer {
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= sourceCount;
  let answer = String(raw.answer ?? '').trim();
  // Markers may list several sources: [2] or [1, 7]. Keep only numbers that exist.
  const marker = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
  const inText = [...answer.matchAll(marker)].flatMap((m) => m[1].split(',').map(Number));
  answer = answer
    .replace(marker, (_m, list: string) => {
      const keep = list.split(',').map(Number).filter(valid);
      return keep.length ? `[${keep.join(', ')}]` : '';
    })
    .replace(/\s+([.,;])/g, '$1')
    .trim();
  const listed = Array.isArray(raw.citations) ? raw.citations.map(Number) : [];
  const citations = [...new Set([...inText, ...listed].filter(valid))].sort((a, b) => a - b);
  const found = raw.found === true && answer.length > 0;
  return { answer, found, citations, verified: found && citations.length > 0 };
}
