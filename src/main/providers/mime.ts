import type { Address, Category, Unsubscribe } from '../../shared/types';

/** Label / category names the autopilot files mail under. */
export const LABEL_NAMES: Record<Category, string> = {
  action: 'Action',
  reply: 'Reply',
  fyi: 'FYI',
  newsletter: 'Newsletters',
  promo: 'Promotions',
  notification: 'Notifications',
  spam: 'Spam',
};

/** Parses `<mailto:...>, <https://...>` plus the RFC 8058 one-click marker. */
export function parseListUnsubscribe(value?: string, post?: string): Unsubscribe | undefined {
  if (!value) return undefined;
  const targets = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  const mailto = targets.find((t) => /^mailto:/i.test(t));
  const url = targets.find((t) => /^https:\/\//i.test(t));
  if (!mailto && !url) return undefined;
  return { mailto, url, oneClick: !!url && /List-Unsubscribe=One-Click/i.test(post ?? '') };
}

export function parseAddress(value: string): Address {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: value.trim() };
}

export function splitAddresses(value: string): string[] {
  return (value.match(/(?:"[^"]*"|[^,])+/g) ?? []).map((a) => parseAddress(a).email).filter(Boolean);
}

/** Strips CR/LF (header injection from untrusted subjects) and RFC 2047-encodes non-ASCII text. */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

export function formatAddress(a: Address): string {
  if (!a.name) return a.email;
  const name = /^[\x20-\x7e]*$/.test(a.name) ? `"${a.name.replace(/["\r\n]/g, '')}"` : encodeHeader(a.name);
  return `${name} <${a.email}>`;
}

export function reSubject(subject: string): string {
  return /^\s*re:/i.test(subject) ? subject : `Re: ${subject}`;
}

/** A plain-text message (reply or new) as a base64url RFC 2822 message, as the Gmail API expects. */
export function buildReplyMime(o: {
  from: string;
  to: string;
  subject: string;
  inReplyTo?: string;
  references?: string;
  text: string;
}): string {
  const headers = [
    `From: ${o.from}`,
    `To: ${o.to}`,
    `Subject: ${encodeHeader(o.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  if (o.inReplyTo) headers.push(`In-Reply-To: ${encodeHeader(o.inReplyTo)}`);
  if (o.references) headers.push(`References: ${encodeHeader(o.references)}`);
  const body = Buffer.from(o.text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url');
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

export function cleanBody(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 20_000);
}

export function isBulkMail(listUnsubscribe?: string, precedence?: string, autoSubmitted?: string): boolean {
  return (
    !!listUnsubscribe ||
    /bulk|list|junk/i.test(precedence ?? '') ||
    (!!autoSubmitted && autoSubmitted.trim().toLowerCase() !== 'no')
  );
}
