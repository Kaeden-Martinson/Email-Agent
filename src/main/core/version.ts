// Update checks: compare versions and read an update feed. Lodestar only tells you about an update;
// downloading and installing it stays your decision.

/** Numeric comparison of "1.2.10" style versions (a leading "v" and pre-release tags are tolerated). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.trim().replace(/^v/i, '').split('-', 2);
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? '' };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  // A release beats its own pre-release (1.0.0 > 1.0.0-beta).
  if (x.pre !== y.pre) return x.pre === '' ? 1 : y.pre === '' ? -1 : x.pre < y.pre ? -1 : 1;
  return 0;
}

export interface FeedRelease {
  version: string;
  url: string;
  notes: string;
}

/**
 * Accepts either a simple JSON feed ({ "version", "url", "notes" }) or the GitHub "latest release" API
 * response ({ "tag_name", "html_url", "body" }). Only https download links are accepted.
 */
export function parseFeed(json: unknown): FeedRelease {
  const o = (json ?? {}) as Record<string, unknown>;
  const version = String(o.version ?? o.tag_name ?? '').trim();
  const url = String(o.url ?? o.html_url ?? '').trim();
  const notes = String(o.notes ?? o.body ?? '').slice(0, 2000);
  if (!/^v?\d+(\.\d+)*(-[\w.]+)?$/.test(version)) throw new Error('The update feed has no valid version.');
  if (!/^https:\/\//.test(url)) throw new Error('The update feed has no https download link.');
  return { version: version.replace(/^v/i, ''), url, notes };
}
