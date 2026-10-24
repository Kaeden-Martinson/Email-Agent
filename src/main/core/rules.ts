// Sorting rules learned from corrections or written by hand. Rules always win over the AI.
import type {
  Category,
  Correction,
  CorrectionKind,
  EmailMessage,
  Priority,
  Rule,
  SuggestedRule,
  Triage,
} from '../../shared/types';

/** Categories that stop making sense once the user says the email matters. */
const LOW: Category[] = ['newsletter', 'promo', 'spam'];

export const domainOf = (email: string) => email.toLowerCase().split('@')[1] ?? '';

/** Shared webmail domains: a rule for "everyone at gmail.com" would sweep up unrelated people. */
const PUBLIC_DOMAINS = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|zoho|mail|yandex|fastmail)\.[a-z.]+$/;

export function domainRuleAllowed(domain: string): boolean {
  return !!domain && !PUBLIC_DOMAINS.test(domain.toLowerCase());
}

/** The most specific enabled rule: an exact sender beats a domain. */
export function matchRule(m: EmailMessage, rules: readonly Rule[]): Rule | undefined {
  const sender = m.from.email.toLowerCase();
  const domain = domainOf(sender);
  const enabled = rules.filter((r) => r.enabled);
  return (
    enabled.find((r) => r.match.sender?.toLowerCase() === sender) ??
    enabled.find((r) => !!r.match.domain && r.match.domain.toLowerCase() === domain)
  );
}

/** Rules that make mail unimportant can skip the model entirely. */
export function ruleSkipsModel(rule: Rule): boolean {
  return rule.effect.hide === true || rule.effect.priority === 3;
}

export function describeRule(rule: Rule): string {
  const who = rule.match.sender ?? `anyone at ${rule.match.domain}`;
  const what = rule.effect.hide
    ? 'hide (mark done)'
    : rule.effect.priority === 1
      ? 'always important'
      : rule.effect.priority === 3
        ? 'always low priority'
        : rule.effect.category
          ? `always ${rule.effect.category}`
          : 'normal priority';
  return `${who}: ${what}`;
}

/** Applies a rule on top of a triage, whether it came from the model or the prefilter. */
export function applyRule<T extends Pick<Triage, 'category' | 'priority' | 'reason' | 'needsReply'>>(t: T, rule: Rule): T {
  const out = { ...t, reason: `Your rule: ${describeRule(rule)}` } as T & { ruleId?: string };
  if (rule.effect.category) out.category = rule.effect.category;
  if (rule.effect.priority) out.priority = rule.effect.priority;
  // Promoting junk-category mail to important means it is no longer junk to this user.
  if (rule.effect.priority === 1 && LOW.includes(out.category) && !rule.effect.category) out.category = 'fyi';
  out.ruleId = rule.id;
  return out;
}

/** One correction to one email. Never changes anything beyond this email. */
export function correctOnce(
  t: Pick<Triage, 'category' | 'priority'>,
  kind: CorrectionKind,
): { category: Category; priority: Priority } {
  if (kind === 'more') {
    return {
      priority: Math.max(1, t.priority - 1) as Priority,
      category: LOW.includes(t.category) ? 'fyi' : t.category,
    };
  }
  // "Less important" steps down one level; "Junk" goes straight to the bottom.
  return { category: t.category, priority: (kind === 'junk' ? 3 : Math.min(3, t.priority + 1)) as Priority };
}

export function ruleEffectFor(kind: CorrectionKind): Rule['effect'] {
  if (kind === 'more') return { priority: 1 };
  if (kind === 'junk') return { priority: 3, hide: true };
  return { priority: 3 };
}

/**
 * Suggests a sender rule after repeated same-direction corrections, never from a single one,
 * and never when a rule for that sender already exists.
 */
export function suggestRules(corrections: readonly Correction[], rules: readonly Rule[], threshold = 2): SuggestedRule[] {
  const groups = new Map<string, { up: number; down: number }>();
  for (const c of corrections) {
    const g = groups.get(c.sender) ?? { up: 0, down: 0 };
    if (c.kind === 'more') g.up++;
    else g.down++;
    groups.set(c.sender, g);
  }
  const out: SuggestedRule[] = [];
  for (const [sender, g] of groups) {
    if (rules.some((r) => r.match.sender === sender)) continue;
    // Mixed signals: don't guess.
    if (g.up && g.down) continue;
    if (g.up >= threshold) out.push({ match: { sender }, effect: { priority: 1 }, because: `You marked ${g.up} emails from ${sender} as more important.` });
    if (g.down >= threshold) out.push({ match: { sender }, effect: { priority: 3 }, because: `You marked ${g.down} emails from ${sender} as less important or junk.` });
  }
  return out;
}
