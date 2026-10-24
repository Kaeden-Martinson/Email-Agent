import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_PERMISSIONS,
  NOTIFY_EVENTS,
  type NotifyEvent,
  type NoteRecord,
  type Account,
  type ActivityEntry,
  type Briefing,
  type Commitment,
  type Correction,
  type FollowUp,
  type KeyItem,
  type Reminder,
  type Rule,
  type Settings,
  type Update,
} from '../shared/types';

function allEvents(on: boolean): Record<NotifyEvent, boolean> {
  return Object.fromEntries(NOTIFY_EVENTS.map((e) => [e, on])) as Record<NotifyEvent, boolean>;
}

export const DEFAULT_SETTINGS: Settings = {
  userName: '',
  onboarded: false,
  pollMinutes: 5,
  lookbackHours: 48,
  followUpDays: 3,
  briefing: {
    enabled: true,
    time: '08:00',
    days: 'everyday',
    sections: { urgent: true, deadlines: true, followups: true, approvals: true },
  },
  notifications: {
    enabled: true,
    quiet: { enabled: false, start: '22:00', end: '07:00', allowUrgent: false },
    desktop: { enabled: true, level: 'sender', events: allEvents(true) },
    // Phone channels start off, and at "minimal" so no email details leave the PC unless you choose.
    ntfy: { enabled: false, level: 'minimal', events: { ...allEvents(true), approval: false }, server: 'https://ntfy.sh', topic: '' },
    telegram: { enabled: false, level: 'minimal', events: { ...allEvents(true), approval: false }, chatId: '' },
    maxPerHour: 10,
  },
  ollama: { url: 'http://127.0.0.1:11434', model: 'llama3.1:8b', fastModel: '', embedModel: '' },
  previewMode: true,
  google: { clientId: '', clientSecret: '' },
  microsoft: { clientId: '', tenant: 'common' },
  autoReply: {
    categories: ['reply'],
    dailySendCap: 10,
    tone: 'Friendly, brief and professional',
    disclose: true,
  },
};

interface Persisted {
  version: 1;
  accounts: Account[];
  updates: Record<string, Update>;
  settings: Settings;
  /** accountId:threadId pairs that already got a reply or draft from us. */
  repliedThreads: string[];
  /** Timestamps of auto-sent replies, for the daily cap. */
  sendLog: number[];
  /** accountId:sender -> when and how we unsubscribed. */
  unsubscribed: Record<string, { at: number; method: string }>;
  /** Local date (YYYY-MM-DD) of the last morning briefing. */
  lastBriefingDay?: string;
  briefing?: Briefing;
  rules: Rule[];
  corrections: Correction[];
  /** Newest last. */
  activity: ActivityEntry[];
  followUps: FollowUp[];
  commitments: Commitment[];
  reminders: Reminder[];
  items: KeyItem[];
  notify: {
    /** Notification key -> when sent (de-duplication). */
    log: Record<string, number>;
    /** Held during quiet hours or over the rate limit; sent later as one summary. */
    held: NoteRecord[];
    phoneTimes: number[];
    status: Partial<Record<'desktop' | 'ntfy' | 'telegram', { lastSentAt?: number; lastError?: string }>>;
  };
  /** When each owed reply's conversation was last checked for your reply. */
  owedCheckedAt: Record<string, number>;
}

export function mergeSettings(base: Settings, patch: Partial<Settings> | undefined): Settings {
  const p = patch ?? {};
  const autoReply = { ...base.autoReply, ...p.autoReply };
  return {
    ...base,
    ...p,
    briefing: { ...base.briefing, ...p.briefing, sections: { ...base.briefing.sections, ...p.briefing?.sections } },
    notifications: mergeNotifications(base.notifications, p.notifications),
    ollama: { ...base.ollama, ...p.ollama },
    google: { ...base.google, ...p.google },
    microsoft: { ...base.microsoft, ...p.microsoft },
    autoReply: {
      categories: autoReply.categories,
      dailySendCap: autoReply.dailySendCap,
      tone: autoReply.tone,
      disclose: autoReply.disclose,
    },
  };
}

function mergeNotifications(base: Settings['notifications'], p: Partial<Settings['notifications']> | undefined): Settings['notifications'] {
  const n = p ?? {};
  const channel = <T extends { events: Record<NotifyEvent, boolean> }>(b: T, o: Partial<T> | undefined): T => ({
    ...b,
    ...o,
    events: { ...b.events, ...o?.events },
  });
  return {
    ...base,
    ...n,
    quiet: { ...base.quiet, ...n.quiet },
    desktop: channel(base.desktop, n.desktop),
    ntfy: channel(base.ntfy, n.ntfy),
    telegram: channel(base.telegram, n.telegram),
  };
}

/** Fills fields added in later versions so older state files keep working. */
function normalizeAccount(a: Account): Account {
  return {
    ...a,
    providerName: a.providerName ?? (a.kind === 'gmail' ? 'Gmail' : 'Outlook'),
    watching: a.watching ?? true,
    permissions: { ...DEFAULT_PERMISSIONS, ...a.permissions },
  };
}

/** App state kept as one JSON file in the user-data folder. Secrets live separately in secrets.ts. */
export class Store {
  readonly data: Persisted;
  private file = path.join(app.getPath('userData'), 'state.json');
  private timer?: NodeJS.Timeout;

  constructor() {
    this.data = this.load();
  }

  private load(): Persisted {
    const fresh: Persisted = {
      version: 1,
      accounts: [],
      updates: {},
      settings: DEFAULT_SETTINGS,
      repliedThreads: [],
      sendLog: [],
      unsubscribed: {},
      rules: [],
      corrections: [],
      activity: [],
      followUps: [],
      commitments: [],
      reminders: [],
      items: [],
      notify: { log: {}, held: [], phoneTimes: [], status: {} },
      owedCheckedAt: {},
    };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Persisted>;
      return {
        ...fresh,
        ...raw,
        accounts: (raw.accounts ?? []).map(normalizeAccount),
        settings: mergeSettings(DEFAULT_SETTINGS, raw.settings),
      };
    } catch {
      return fresh;
    }
  }

  save(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush(): void {
    clearTimeout(this.timer);
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
