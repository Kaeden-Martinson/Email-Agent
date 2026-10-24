import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
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
import { migrate, SCHEMA_VERSION } from './core/migrate';
import type { Signal } from './core/rules';
import { log } from './logger';
import { decryptText, encryptText, vaultAvailable } from './vault';

function allEvents(on: boolean): Record<NotifyEvent, boolean> {
  return Object.fromEntries(NOTIFY_EVENTS.map((e) => [e, on])) as Record<NotifyEvent, boolean>;
}

/** Official releases (GitHub). Pilot only reports updates; installing stays your choice. */
export const UPDATE_FEED = 'https://api.github.com/repos/Kaeden-Martinson/Email-Agent/releases/latest';

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
  ollama: { url: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', fastModel: '', embedModel: '' },
  previewMode: true,
  encryptAtRest: true,
  launchAtLogin: false,
  updates: { check: true, feedUrl: UPDATE_FEED },
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
  schemaVersion: number;
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
  /** What you did with emails (archive, done, reply), for behavior-based rule suggestions. Newest last. */
  signals: Signal[];
  /** Suggestions you said "Not now" to, as sender|priority. */
  dismissedSuggestions: string[];
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
    updates: { ...base.updates, ...p.updates },
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

/** Today's local date, YYYY-MM-DD. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const KEEP_BACKUPS = 7;

/**
 * App state in one file in the user-data folder: state.enc (encrypted with the OS keystore, the default)
 * or state.json. Writes are atomic and serialized; one backup per day is kept for a week; an unreadable
 * file is moved aside (never overwritten) and the newest readable backup is used instead.
 */
export class Store {
  data!: Persisted;
  /** Set when the data could not be read and a backup or a fresh start was used; shown to the user. */
  recovered?: string;
  private dir = app.getPath('userData');
  private plain = path.join(this.dir, 'state.json');
  private enc = path.join(this.dir, 'state.enc');
  private backups = path.join(this.dir, 'backups');
  private timer?: NodeJS.Timeout;
  private writes: Promise<void> = Promise.resolve();
  private lastBackupDay = '';

  private constructor() {}

  static async open(): Promise<Store> {
    const s = new Store();
    s.data = await s.load();
    return s;
  }

  private fresh(): Persisted {
    return {
      version: 1,
      schemaVersion: SCHEMA_VERSION,
      accounts: [],
      updates: {},
      settings: DEFAULT_SETTINGS,
      repliedThreads: [],
      sendLog: [],
      unsubscribed: {},
      rules: [],
      corrections: [],
      signals: [],
      dismissedSuggestions: [],
      activity: [],
      followUps: [],
      commitments: [],
      reminders: [],
      items: [],
      notify: { log: {}, held: [], phoneTimes: [], status: {} },
      owedCheckedAt: {},
    };
  }

  private async read(file: string): Promise<Partial<Persisted>> {
    const buf = fs.readFileSync(file);
    const text = file.endsWith('.enc') ? (await decryptText(buf)).text : buf.toString('utf8');
    return JSON.parse(text) as Partial<Persisted>;
  }

  private async load(): Promise<Persisted> {
    const backups = fs.existsSync(this.backups)
      ? fs.readdirSync(this.backups).filter((f) => /^state-\d{4}-\d{2}-\d{2}\.(json|enc)$/.test(f)).sort().reverse().map((f) => path.join(this.backups, f))
      : [];
    const candidates = [this.enc, this.plain].filter((f) => fs.existsSync(f));
    for (const file of [...candidates, ...backups]) {
      try {
        const raw = migrate((await this.read(file)) as Record<string, unknown>) as Partial<Persisted>;
        if (!candidates.includes(file)) {
          this.recovered = `Pilot's data file couldn't be read, so it was restored from the backup of ${path.basename(file).slice(6, 16)}.`;
          log.warn('store.restored_from_backup', { backup: path.basename(file) });
        }
        const settings = mergeSettings(DEFAULT_SETTINGS, raw.settings);
        // Saved before releases existed: use the official feed (switch checks off in Settings to stop them).
        if (!settings.updates.feedUrl) settings.updates = { ...settings.updates, feedUrl: UPDATE_FEED };
        return { ...this.fresh(), ...raw, settings } as Persisted;
      } catch (e) {
        if (candidates.includes(file)) {
          const aside = `${file}.unreadable-${Date.now()}`;
          fs.renameSync(file, aside);
          log.error('store.unreadable', { file: path.basename(file), keptAs: path.basename(aside), error: e });
        }
      }
    }
    if (candidates.length) this.recovered = "Pilot's data couldn't be read and no backup was usable, so it started fresh. The unreadable file was kept.";
    return this.fresh();
  }

  save(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 400);
  }

  /** Resolves when everything changed so far is on disk. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    const snapshot = JSON.stringify(this.data);
    const encrypt = this.data.settings.encryptAtRest;
    this.writes = this.writes.then(() => this.write(snapshot, encrypt)).catch((e) => log.error('store.write_failed', { error: e }));
    return this.writes;
  }

  private async write(json: string, encrypt: boolean): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    this.backupOncePerDay();
    const useEnc = encrypt && (await vaultAvailable());
    const target = useEnc ? this.enc : this.plain;
    const other = useEnc ? this.plain : this.enc;
    const body = useEnc ? await encryptText(json) : json;
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, body);
    if (useEnc) {
      // Prove the encrypted copy reads back before relying on it.
      const check = await decryptText(fs.readFileSync(tmp));
      if (check.text !== json) throw new Error('Encrypted data did not read back correctly; kept the previous file.');
    }
    fs.renameSync(tmp, target);
    if (fs.existsSync(other)) fs.unlinkSync(other);
    if (useEnc) await this.encryptPlainBackups();
  }

  /** With encryption on, backups made before it was turned on are encrypted too (plain copies removed). */
  private async encryptPlainBackups(): Promise<void> {
    if (!fs.existsSync(this.backups)) return;
    for (const f of fs.readdirSync(this.backups).filter((x) => /^state-.*\.json$/.test(x))) {
      const plain = path.join(this.backups, f);
      const enc = plain.replace(/\.json$/, '.enc');
      const json = fs.readFileSync(plain, 'utf8');
      const buf = await encryptText(json);
      if ((await decryptText(buf)).text !== json) continue; // keep the plain copy if the round trip fails
      fs.writeFileSync(enc, buf);
      fs.unlinkSync(plain);
    }
  }

  private backupOncePerDay(): void {
    const day = today();
    if (this.lastBackupDay === day) return;
    const current = [this.enc, this.plain].find((f) => fs.existsSync(f));
    if (!current) return;
    fs.mkdirSync(this.backups, { recursive: true });
    const dest = path.join(this.backups, `state-${day}${path.extname(current)}`);
    if (!fs.existsSync(dest)) fs.copyFileSync(current, dest);
    const all = fs.readdirSync(this.backups).filter((f) => f.startsWith('state-')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(this.backups, old));
    this.lastBackupDay = day;
  }

  dataDir(): string {
    return this.dir;
  }
}
