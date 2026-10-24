// Grouping repeated emails (the same alert or notification several times) so they read as one item.

/** Same sender domain + the subject with numbers, codes, reply prefixes and punctuation removed. */
export function similarKey(fromEmail: string, subject: string): string {
  const domain = fromEmail.toLowerCase().split('@')[1] ?? fromEmail.toLowerCase();
  const subj = subject
    .toLowerCase()
    .replace(/^(?:(?:re|fw|fwd|aw)\s*:\s*)+/g, '')
    .replace(/[#]?\b[\w-]*\d[\w-]*\b/g, ' ') // order numbers, codes, dates, amounts
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${domain}|${subj}`;
}

export interface Groupable {
  key: string;
  from: string;
  subject: string;
  at: number;
}

/**
 * Clusters items with the same similarity key received within `windowDays` of each other.
 * Returns clusters newest-first; single items come back as clusters of one.
 */
export function cluster<T extends Groupable>(items: readonly T[], windowDays = 7): T[][] {
  const sorted = [...items].sort((a, b) => b.at - a.at);
  const out: T[][] = [];
  const open = new Map<string, T[]>();
  for (const it of sorted) {
    const k = similarKey(it.from, it.subject);
    const c = open.get(k);
    // Compare with the oldest member so far, so a cluster spans at most the window.
    if (c && c[c.length - 1].at - it.at <= windowDays * 86_400_000 && k.split('|')[1]) {
      c.push(it);
    } else {
      const fresh = [it];
      open.set(k, fresh);
      out.push(fresh);
    }
  }
  return out;
}
