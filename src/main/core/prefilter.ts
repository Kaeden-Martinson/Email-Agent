// Stage 1 of the triage pipeline: deterministic rules that classify obvious mail without the model,
// and route everything else to the light or full model.
import type { EmailMessage, Triage } from '../../shared/types';
import { NO_REPLY_SENDER } from './policy';

/** Words that make bulk mail worth a real read: accounts, money, safety, school, appointments. */
const IMPORTANT =
  /\b(security|password|sign[- ]?in|verif(?:y|ication)|two[- ]factor|2fa|suspicious|fraud|unauthori[sz]ed|payment|invoice|bill(?:ing)?|overdue|past due|due (?:date|on|by)|receipt|refund|your order|order (?:#|number|confirm)|shipped|out for delivery|delivered|appointment|reservation|booking|deadline|admissions?|application|interview|tuition|financial aid|enrol(?:l)?ment|tax(?:es)?|statement|expir(?:es|ing|ed)|renew(?:al)?|account (?:alert|notice|update)|action required)\b/i;

const PROMO =
  /(\d+\s?% off|\bsale\b|\bdeals?\b|discount|coupon|promo code|free shipping|limited[- ]time|shop now|exclusive offer|save \$|\bbogo\b|clearance|black friday|cyber monday|flash sale|one day only|last chance|new arrivals)/i;

export type Route =
  | { route: 'fast'; triage: Omit<Triage, 'model'> }
  | { route: 'light' | 'full'; reason: string };

function sample(m: EmailMessage, bodyChars: number): string {
  return `${m.subject}\n${m.snippet}\n${m.body.slice(0, bodyChars)}`;
}

export function prefilter(m: EmailMessage): Route {
  const sender = m.from.name || m.from.email;
  if (m.isBulk) {
    const promo = PROMO.test(sample(m, 2000));
    // For promotions only the subject and preview count: fine print like "offer expires after receipt"
    // is not a deadline. Real bills and alerts say what they are up front.
    const important = IMPORTANT.test(`${m.subject}\n${m.snippet}`) || (!promo && IMPORTANT.test(m.body.slice(0, 1500)));
    if (important) {
      return { route: 'light', reason: 'Bulk mail that mentions an account, money, school or a deadline' };
    }
    return {
      route: 'fast',
      triage: {
        category: promo ? 'promo' : 'newsletter',
        priority: 3,
        summary: `${promo ? 'Promotion' : 'Newsletter'} from ${sender}: "${m.subject || '(no subject)'}". Nothing to do.`,
        actionItems: [],
        needsReply: false,
        draftReply: '',
        source: 'fast',
        reason: promo
          ? 'Mailing-list mail with sales language (decided by rules, no AI needed)'
          : 'Mailing-list mail with an unsubscribe header (decided by rules, no AI needed)',
      },
    };
  }
  if (NO_REPLY_SENDER.test(m.from.email)) {
    return { route: 'light', reason: 'Automated sender, so a quick read is enough' };
  }
  return { route: 'full', reason: 'Personal email, so it gets a full read' };
}

/** Processing order: rule-decided first (instant), then unread personal mail, then the rest, newest first. */
export function processingRank(m: EmailMessage): number {
  const r = prefilter(m);
  if (r.route === 'fast') return 0;
  if (r.route === 'full') return m.unread === false ? 2 : 1;
  return m.unread === false ? 4 : 3;
}
