import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_PERMISSIONS,
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

export const DEFAULT_SETTINGS: Settings = {
  userName: '',
  onboarded: false,
  pollMinutes: 5,
  lookbackHours: 48,
  followUpDays: 3,
  briefing: { enabled: true, time: '08:00' },
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
  /** When each owed reply's conversation was last checked for your reply. */
  owedCheckedAt: Record<string, number>;
}

export function mergeSettings(base: Settings, patch: Partial<Settings> | undefined): Settings {
  const p = patch ?? {};
  const autoReply = { ...base.autoReply, ...p.autoReply };
  return {
    ...base,
    ...p,
    briefing: { ...base.briefing, ...p.briefing },
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
