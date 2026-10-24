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

const subjectHas = (m: EmailMessage, words: string | undefined) => !words || m.subject.toLowerCase().includes(words.toLowerCase());

/**
 * The most specific enabled rule: an exact sender beats a domain, which beats subject words alone;
 * at each level, a rule that also checks the subject beats one that doesn't.
 */
export function matchRule(m: EmailMessage, rules: readonly Rule[]): Rule | undefined {
  const sender = m.from.email.toLowerCase();
  const domain = domainOf(sender);
  const enabled = rules.filter((r) => r.enabled && subjectHas(m, r.match.subjectContains));
  const best = (xs: Rule[]) => xs.find((r) => r.match.subjectContains) ?? xs[0];
  return (
    best(enabled.filter((r) => r.match.sender?.toLowerCase() === sender)) ??
    best(enabled.filter((r) => !!r.match.domain && r.match.domain.toLowerCase() === domain)) ??
    enabled.find((r) => !r.match.sender && !r.match.domain && r.match.subjectContains)
  );
}

/** Same sender/domain/subject means the same rule (a new one replaces it). */
export function sameMatch(a: Rule['match'], b: Rule['match']): boolean {
  const n = (x?: string) => x?.toLowerCase() ?? '';
  return n(a.sender) === n(b.sender) && n(a.domain) === n(b.domain) && n(a.subjectContains) === n(b.subjectContains);
}

/** "Emails with "invoice" in the subject from anyone at acme.com". */
export function describeMatch(match: Rule['match']): string {
  const who = match.sender ?? (match.domain ? `anyone at ${match.domain}` : 'anyone');
  return match.subjectContains ? `${who}, subject contains "${match.subjectContains}"` : who;
}

/** Rules that make mail unimportant can skip the model entirely. */
export function ruleSkipsModel(rule: Rule): boolean {
  return rule.effect.hide === true || rule.effect.priority === 3;
}

export function describeRule(rule: Rule): string {
  const who = describeMatch(rule.match);
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

/** What you did with an email, used to learn which senders matter to you. */
export interface Signal {
  sender: string;
  kind: 'archived' | 'dismissed' | 'replied';
  /** The email's priority when you acted. */
  priority: number;
  at: number;
}

/**
 * Suggestions learned from behavior, needing more evidence than explicit corrections:
 * three archives/dismissals of important-looking mail without ever replying → low priority;
 * three replies to mail Pilot didn't mark urgent → always important. Suggestions only, never automatic.
 */
export function suggestFromSignals(signals: readonly Signal[], rules: readonly Rule[], threshold = 3): SuggestedRule[] {
  const since = Date.now() - 60 * 86_400_000;
  const by = new Map<string, { down: number; up: number; replied: number }>();
  for (const s of signals) {
    if (s.at < since) continue;
    const g = by.get(s.sender) ?? { down: 0, up: 0, replied: 0 };
    if (s.kind === 'replied') {
      g.replied++;
      if (s.priority >= 2) g.up++;
    } else if (s.priority <= 2) {
      g.down++;
    }
    by.set(s.sender, g);
  }
  const out: SuggestedRule[] = [];
  for (const [sender, g] of by) {
    if (rules.some((r) => r.match.sender === sender)) continue;
    if (g.down >= threshold && g.replied === 0) {
      out.push({ match: { sender }, effect: { priority: 3 }, because: `You archived or dismissed ${g.down} emails from ${sender} without replying.` });
    } else if (g.up >= threshold && g.down === 0) {
      out.push({ match: { sender }, effect: { priority: 1 }, because: `You replied to ${g.up} emails from ${sender} that weren't marked urgent.` });
    }
  }
  return out;
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
