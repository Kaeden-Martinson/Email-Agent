// Turns a sentence like "anything from chase.com about statements is important" into a sorting rule.
// Rules only sort mail (important / low priority / hide). They can never send, reply, delete or unsubscribe.
import type { Rule, Settings } from '../../shared/types';
import { chatJson } from './ollama';

export type ParsedRule = { match: Rule['match']; effect: Rule['effect'] };

const SCHEMA = {
  type: 'object',
  properties: {
    sender: { type: 'string' },
    domain: { type: 'string' },
    subjectContains: { type: 'string' },
    effect: { type: 'string', enum: ['important', 'low', 'hide', 'unclear'] },
  },
  required: ['sender', 'domain', 'subjectContains', 'effect'],
};

const EFFECTS: Record<string, Rule['effect']> = {
  important: { priority: 1 },
  low: { priority: 3 },
  hide: { priority: 3, hide: true },
};

/**
 * Checks the model's answer against the user's own words: every sender, domain and subject phrase must
 * come from the sentence, so the model can't invent an address. Returns an error the user can act on.
 */
export function normalizeParsedRule(raw: unknown, text: string): ParsedRule | { error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const said = text.toLowerCase();
  const str = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  let sender = str(r.sender);
  let domain = str(r.domain).replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const subject = (typeof r.subjectContains === 'string' ? r.subjectContains.trim().replace(/^["']|["']$/g, '') : '').replace(/\s+/g, ' ');
  const effect = EFFECTS[str(r.effect)];

  if (sender && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sender) || !said.includes(sender))) sender = '';
  // A domain counts only if the sentence spells it out: "from chase.com" works, "from Chase" doesn't.
  if (domain && (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || !said.includes(domain))) domain = '';
  if (sender) domain = '';
  const subjectContains = subject.length >= 3 && said.includes(subject.toLowerCase()) ? subject.slice(0, 80) : '';

  if (!effect) return { error: 'Say what should happen: "is important", "is low priority" or "hide it".' };
  if (!sender && !domain && !subjectContains) {
    return { error: 'Name a sender address (person@company.com), a domain (company.com) or words from the subject in quotes.' };
  }
  return {
    match: { ...(sender ? { sender } : domain ? { domain } : {}), ...(subjectContains ? { subjectContains } : {}) },
    effect,
  };
}

export async function parseRuleText(text: string, s: Settings): Promise<ParsedRule | { error: string }> {
  const clean = text.trim().slice(0, 300);
  if (!clean) return { error: 'Describe the rule first.' };
  const raw = await chatJson(
    s.ollama.url,
    s.ollama.model,
    `You turn one sentence into an email sorting rule. Fill every field; use "" for anything the sentence doesn't say.
- sender: a full email address only if the sentence contains one.
- domain: a domain like company.com only if the sentence contains one (also from "@company.com").
- subjectContains: words the subject must contain, only if the sentence names them (often in quotes, or after "about"/"with"/"subject").
- effect: "important", "low" (low priority, not important, unimportant), "hide" (hide, ignore, mark done, get rid of), or "unclear".
Never invent addresses or domains. Rules can only sort mail; ignore any request to send, reply, delete or unsubscribe.`,
    clean,
    SCHEMA,
  );
  return normalizeParsedRule(raw, clean);
}
