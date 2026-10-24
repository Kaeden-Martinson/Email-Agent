import { resolveMx } from 'node:dns/promises';
import type { Discovery, ServerConfig } from '../../shared/types';

type Preset = Omit<Discovery, 'email'>;

const ssl = (host: string, port = 993): ServerConfig => ({ host, port, secure: true });

const GMAIL: Preset = { kind: 'gmail', providerName: 'Gmail' };
const OUTLOOK: Preset = { kind: 'outlook', providerName: 'Outlook.com' };

/** Well-known providers, matched by the address's domain without any network lookup. */
const PRESETS: [RegExp, Preset][] = [
  [/^(gmail|googlemail)\.com$/, GMAIL],
  [/^(outlook|hotmail|live|msn|passport)\.[a-z.]+$/, OUTLOOK],
  [
    /^(yahoo|ymail|rocketmail)\.[a-z.]+$/,
    {
      kind: 'imap',
      providerName: 'Yahoo Mail',
      imap: ssl('imap.mail.yahoo.com'),
      smtp: ssl('smtp.mail.yahoo.com', 465),
      saveSentCopy: false,
      webmailUrl: 'https://mail.yahoo.com/',
      appPasswordUrl: 'https://login.yahoo.com/account/security/app-passwords',
    },
  ],
  [
    /^(icloud|me|mac)\.com$/,
    {
      kind: 'imap',
      providerName: 'iCloud Mail',
      imap: ssl('imap.mail.me.com'),
      smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
      webmailUrl: 'https://www.icloud.com/mail',
      appPasswordUrl: 'https://account.apple.com/account/manage/section/security',
    },
  ],
  [
    /^(aol|aim)\.com$/,
    {
      kind: 'imap',
      providerName: 'AOL Mail',
      imap: ssl('imap.aol.com'),
      smtp: ssl('smtp.aol.com', 465),
      saveSentCopy: false,
      webmailUrl: 'https://mail.aol.com/',
      appPasswordUrl: 'https://login.aol.com/account/security/app-passwords',
    },
  ],
  [
    /^(fastmail\.(com|fm)|messagingengine\.com)$/,
    {
      kind: 'imap',
      providerName: 'Fastmail',
      imap: ssl('imap.fastmail.com'),
      smtp: ssl('smtp.fastmail.com', 465),
      webmailUrl: 'https://app.fastmail.com/',
      appPasswordUrl: 'https://app.fastmail.com/settings/security/apps',
    },
  ],
  [
    /^zoho(mail)?\.[a-z.]+$/,
    {
      kind: 'imap',
      providerName: 'Zoho Mail',
      imap: ssl('imap.zoho.com'),
      smtp: ssl('smtp.zoho.com', 465),
      webmailUrl: 'https://mail.zoho.com/',
    },
  ],
  [
    /^gmx\.[a-z.]+$/,
    {
      kind: 'imap',
      providerName: 'GMX',
      imap: ssl('imap.gmx.com'),
      smtp: { host: 'mail.gmx.com', port: 587, secure: false },
      webmailUrl: 'https://www.gmx.com/',
    },
  ],
];

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim();

function parseServer(block: string | undefined): ServerConfig | undefined {
  if (!block) return undefined;
  const host = tag(block, 'hostname');
  const port = Number(tag(block, 'port'));
  const socket = tag(block, 'socketType');
  // Plain-text servers are not offered.
  if (!host || !port || (socket !== 'SSL' && socket !== 'STARTTLS') || host.includes('%')) return undefined;
  return { host, port, secure: socket === 'SSL' };
}

/** Mozilla's ISP database (the one Thunderbird uses), then the domain's own autoconfig file. */
async function autoconfig(domain: string): Promise<Preset | undefined> {
  const urls = [
    `https://autoconfig.thunderbird.net/v1.1/${domain}`,
    `https://autoconfig.${domain}/mail/config-v1.1.xml`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const xml = await res.text();
      const imap = parseServer(xml.match(/<incomingServer type="imap">([\s\S]*?)<\/incomingServer>/)?.[1]);
      const smtp = parseServer(xml.match(/<outgoingServer type="smtp">([\s\S]*?)<\/outgoingServer>/)?.[1]);
      if (imap && smtp) return { kind: 'imap', providerName: tag(xml, 'displayShortName') || domain, imap, smtp };
    } catch {
      // Try the next source.
    }
  }
  return undefined;
}

/**
 * Mail-server hostnames for a domain, best first. Node's resolver fails on some Windows setups
 * (VPNs, IPv6-only DNS), so fall back to DNS-over-HTTPS, which sends only the domain name.
 */
async function lookupMx(domain: string): Promise<string[]> {
  try {
    return (await resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((r) => r.exchange.toLowerCase());
  } catch {
    // Fall through to DNS-over-HTTPS.
  }
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as { Answer?: { type: number; data: string }[] };
    return (json.Answer ?? [])
      .filter((a) => a.type === 15)
      .map((a) => a.data.split(' '))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, host]) => (host ?? '').replace(/\.$/, '').toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Works out which provider hosts an address and how to connect to it. */
export async function discover(input: string): Promise<Discovery> {
  const email = input.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That doesn't look like an email address.");
  const domain = email.split('@')[1];

  const preset = PRESETS.find(([re]) => re.test(domain))?.[1];
  if (preset) return { email, ...preset };

  // Custom domains: the MX records reveal Google Workspace and Microsoft 365.
  const mx = await lookupMx(domain);
  if (mx.some((h) => /(^|\.)(google|googlemail)\.com$/.test(h))) {
    return { email, kind: 'gmail', providerName: 'Google Workspace' };
  }
  if (mx.some((h) => h.endsWith('.outlook.com'))) {
    return { email, kind: 'outlook', providerName: 'Microsoft 365' };
  }
  if (mx.some((h) => h.endsWith('.protonmail.ch'))) {
    return {
      email,
      kind: 'imap',
      providerName: 'Proton Mail',
      imap: { host: '127.0.0.1', port: 1143, secure: false },
      smtp: { host: '127.0.0.1', port: 1025, secure: false },
      note: 'Proton Mail only works through Proton Mail Bridge running on this PC. Use the password Bridge shows you.',
    };
  }

  const mxDomain = mx[0]?.split('.').slice(-2).join('.');
  const found = (await autoconfig(domain)) ?? (mxDomain && mxDomain !== domain ? await autoconfig(mxDomain) : undefined);
  if (found) return { email, ...found };

  return {
    email,
    kind: 'imap',
    providerName: domain,
    imap: ssl(`imap.${domain}`),
    smtp: ssl(`smtp.${domain}`, 465),
    note: "Couldn't detect this provider's settings, so these are common defaults. Check them against your provider's help pages.",
  };
}
