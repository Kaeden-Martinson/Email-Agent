// Bulk cleanup: which open emails a "archive all promos older than 30 days" request would touch.
// Pure, so the safety rules are tested: never important mail, never mail waiting on a reply.
import type { Category, Update } from '../../shared/types';

/** Only bulk-type categories can be cleaned up in bulk. */
export const CLEANUP_CATEGORIES: Category[] = ['newsletter', 'promo', 'notification', 'spam'];

export interface CleanupFilter {
  categories: Category[];
  olderThanDays: number;
}

export function selectForCleanup(updates: readonly Update[], f: CleanupFilter, now = Date.now()): Update[] {
  const cats = f.categories.filter((c) => CLEANUP_CATEGORIES.includes(c));
  const cutoff = now - Math.max(0, f.olderThanDays) * 86_400_000;
  return updates
    .filter((u) => {
      const t = u.triage;
      if (!t || u.status === 'done' || u.auto?.archived) return false;
      if (!cats.includes(t.category)) return false;
      if (t.priority === 1) return false; // important (by you or a rule) stays
      if (t.needsReply && !t.repliedAlready) return false;
      return u.message.receivedAt <= cutoff;
    })
    .sort((a, b) => b.message.receivedAt - a.message.receivedAt);
}
