// Local search over your mail: tokenizing, query filters, BM25 keyword ranking, vector similarity and
// rank fusion. Pure and synchronous, so it is fast and unit-tested. Nothing leaves the computer.

const STOP = new Set(
  'a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its me my of on or our she so than that the their them then there these they this to was we were what when where which who why will with would you your about any all also am get got just like more most much no not now only other out over said say says some such tell told up us very want'.split(
    ' ',
  ),
);

/** Words people use to ask about mail that carry no meaning for matching. */
const QUESTION_WORDS = new Set(
  'find show search look list email emails mail mails message messages inbox mention mentioned mentions mentioning someone somebody anyone anything something thing things regarding re fw fwd know remember'.split(' '),
);

/** Lowercase words with light stemming, so "deadlines", "deadline" and "Deadline's" match. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+(?:[.'][a-z0-9]+)*/g) ?? [])
    .map((w) => w.replace(/'s$/, '').replace(/'/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

function stem(w: string): string {
  if (w.length <= 4 || /^\d/.test(w)) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ing') && w.length > 6) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 5) return w.slice(0, -2);
  if (w.endsWith('es') && /(?:ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export interface Query {
  /** Free-text terms after removing filters. */
  terms: string[];
  text: string;
  from?: string;
  subject?: string;
  after?: number;
  before?: number;
}

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/**
 * Pulls filters out of a query: `from:dana`, `subject:"lease"`, `after:2026-10-01`, `before:2026-11-01`,
 * and phrases like "yesterday", "last week", "this month", "last 3 days", "from Tennessee Tech".
 */
export function parseQuery(input: string, now: Date = new Date()): Query {
  let s = ` ${input} `;
  const q: Query = { terms: [], text: input.trim() };
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = s.match(re);
    if (m) {
      fn(m);
      s = s.replace(m[0], ' ');
    }
  };
  take(/\bfrom:(?:"([^"]+)"|(\S+))/i, (m) => (q.from = (m[1] ?? m[2]).toLowerCase()));
  take(/\bsubject:(?:"([^"]+)"|(\S+))/i, (m) => (q.subject = (m[1] ?? m[2]).toLowerCase()));
  take(/\bafter:(\d{4}-\d{2}-\d{2})/i, (m) => (q.after = new Date(`${m[1]}T00:00`).getTime()));
  take(/\bbefore:(\d{4}-\d{2}-\d{2})/i, (m) => (q.before = new Date(`${m[1]}T00:00`).getTime()));

  const today = startOfDay(now);
  take(/\b(?:in the |over the )?(?:last|past) (\d+) days?\b/i, (m) => (q.after = today - Number(m[1]) * DAY));
  take(/\byesterday\b/i, () => {
    q.after = today - DAY;
    q.before = today;
  });
  take(/\btoday\b/i, () => (q.after = today));
  take(/\b(?:last|past) week\b/i, () => (q.after = today - 7 * DAY));
  take(/\bthis week\b/i, () => (q.after = today - ((now.getDay() + 6) % 7) * DAY));
  take(/\b(?:last|past) month\b/i, () => (q.after = today - 31 * DAY));
  take(/\bthis month\b/i, () => (q.after = new Date(now.getFullYear(), now.getMonth(), 1).getTime()));
  // "from Tennessee Tech", "emails from Dana" (natural language sender), but not "from:" handled above.
  if (!q.from) take(/\bfrom ([A-Z][\w.&'-]*(?:\s+[A-Z][\w.&'-]*){0,3})/, (m) => (q.from = m[1].toLowerCase()));
  q.terms = tokenize(s.split(/\s+/).filter((w) => !QUESTION_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, ''))).join(' '));
  return q;
}

export interface SearchDoc {
  id: string;
  at: number;
  from: string;
  subject: string;
  /** Summary, key facts and body text; searched with less weight than subject and sender. */
  body: string;
}

interface Indexed {
  doc: SearchDoc;
  tf: Map<string, number>;
  len: number;
}

export interface Index {
  docs: Indexed[];
  df: Map<string, number>;
  avgLen: number;
}

/** Subject and sender words count three times, so "Tennessee Tech" finds their emails first. */
export function buildIndex(docs: readonly SearchDoc[]): Index {
  const df = new Map<string, number>();
  const indexed = docs.map((doc) => {
    const tokens = [...Array(3).fill(tokenize(`${doc.subject} ${doc.from}`)).flat(), ...tokenize(doc.body)];
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return { doc, tf, len: tokens.length };
  });
  const avgLen = indexed.reduce((s, d) => s + d.len, 0) / Math.max(1, indexed.length);
  return { docs: indexed, df, avgLen };
}

export interface Hit {
  id: string;
  score: number;
  matched: string[];
}

function passesFilters(d: SearchDoc, q: Query): boolean {
  if (q.from && !d.from.toLowerCase().includes(q.from)) return false;
  if (q.subject && !d.subject.toLowerCase().includes(q.subject)) return false;
  if (q.after !== undefined && d.at < q.after) return false;
  if (q.before !== undefined && d.at >= q.before) return false;
  return true;
}

/** BM25 over the filtered documents. A query that is only filters lists matches newest first. */
export function keywordSearch(index: Index, q: Query, limit = 20): Hit[] {
  const N = index.docs.length;
  const k1 = 1.4;
  const b = 0.75;
  const hits: Hit[] = [];
  for (const d of index.docs) {
    if (!passesFilters(d.doc, q)) continue;
    if (!q.terms.length) {
      hits.push({ id: d.doc.id, score: d.doc.at / 1e13, matched: [] });
      continue;
    }
    let score = 0;
    const matched: string[] = [];
    for (const t of new Set(q.terms)) {
      const f = d.tf.get(t);
      if (!f) continue;
      matched.push(t);
      const n = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / index.avgLen)));
    }
    if (score > 0) hits.push({ id: d.doc.id, score, matched });
  }
  hits.sort((a, b2) => b2.score - a.score);
  // When some emails match most of the words, drop weak matches on a single common word.
  const best = Math.max(0, ...hits.map((h) => h.matched.length));
  const top = hits[0]?.score ?? 0;
  const strong = hits.filter((h) => h.matched.length * 2 >= best || h.score >= top * 0.5);
  return strong.slice(0, limit);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Reciprocal rank fusion: robust way to combine keyword and semantic rankings without tuning weights. */
export function fuse(lists: readonly (readonly { id: string }[])[], k = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((h, rank) => score.set(h.id, (score.get(h.id) ?? 0) + 1 / (k + rank + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** A short excerpt around the first matching word, for result lists and citations. */
export function snippet(text: string, terms: readonly string[], size = 220): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!terms.length) return clean.slice(0, size);
  const lower = clean.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.search(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return clean.slice(0, size);
  const start = Math.max(0, at - 60);
  return `${start > 0 ? '…' : ''}${clean.slice(start, start + size)}${start + size < clean.length ? '…' : ''}`;
}
