import type { NotificationSettings, NotifierStatus, NotifyChannel, Settings } from '../shared/types';
import { formatNote, inQuietHours, summarizeHeld, type Formatted, type NoteInput } from './core/notify';
import { channelSecrets } from './secrets';
import type { Store } from './store';

const HOUR = 3_600_000;
const PHONE: NotifyChannel[] = ['ntfy', 'telegram'];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface NotifierDeps {
  store: Store;
  settings: () => Settings;
  changed: () => void;
  /** Shows a Windows notification. */
  desktop: (f: Formatted) => void;
}

/**
 * Every notification goes through here: de-duplicated, held during quiet hours, rate-limited on phone
 * channels, and worded at each channel's privacy level. Held notifications are delivered later as one
 * count-only summary.
 */
export class Notifier {
  constructor(private readonly deps: NotifierDeps) {}

  private get n(): NotificationSettings {
    return this.deps.settings().notifications;
  }

  private get d() {
    return this.deps.store.data.notify;
  }

  status(): NotifierStatus {
    const ch = (c: NotifyChannel) => ({ hasSecret: c === 'desktop' || !!channelSecrets.get(c), ...this.d.status[c] });
    return { channels: { desktop: ch('desktop'), ntfy: ch('ntfy'), telegram: ch('telegram') }, held: this.d.held.length };
  }

  private quiet(event: NoteInput['event']): boolean {
    const q = this.n.quiet;
    return q.enabled && inQuietHours(new Date(), q.start, q.end) && !(event === 'urgent' && q.allowUrgent);
  }

  private channels(event: NoteInput['event']): NotifyChannel[] {
    return (['desktop', 'ntfy', 'telegram'] as NotifyChannel[]).filter((c) => this.n[c].enabled && this.n[c].events[event] && this.ready(c));
  }

  private ready(c: NotifyChannel): boolean {
    if (c === 'desktop') return true;
    if (c === 'ntfy') return !!this.n.ntfy.topic;
    return !!this.n.telegram.chatId && !!channelSecrets.get('telegram');
  }

  async notify(note: NoteInput): Promise<void> {
    if (!this.n.enabled || this.d.log[note.key]) return;
    const targets = this.channels(note.event);
    if (!targets.length) return;
    this.d.log[note.key] = Date.now();
    if (this.quiet(note.event)) {
      this.d.held.push(note);
      this.deps.changed();
      return;
    }
    const recent = this.d.phoneTimes.filter((t) => t > Date.now() - HOUR);
    let heldForPhone = false;
    for (const c of targets) {
      if (PHONE.includes(c) && recent.length >= this.n.maxPerHour) {
        heldForPhone = true;
        continue;
      }
      await this.deliver(c, formatNote(note, this.n[c].level), note.event === 'urgent');
    }
    if (heldForPhone) this.d.held.push(note);
    this.deps.changed();
  }

  /** Runs every minute: sends the held summary once quiet hours end. */
  async tick(): Promise<void> {
    if (!this.d.held.length || this.quiet('reminder')) return;
    if (this.d.phoneTimes.filter((t) => t > Date.now() - HOUR).length >= this.n.maxPerHour) return;
    const summary = summarizeHeld(this.d.held);
    this.d.held = [];
    if (summary) {
      for (const c of ['desktop', 'ntfy', 'telegram'] as NotifyChannel[]) {
        if (this.n[c].enabled && this.ready(c)) await this.deliver(c, summary, false);
      }
    }
    this.deps.changed();
  }

  /** User-initiated test: bypasses de-duplication and quiet hours, and reports errors. */
  async test(c: NotifyChannel): Promise<void> {
    if (c !== 'desktop' && !this.ready(c)) {
      throw new Error(c === 'ntfy' ? 'Choose an ntfy topic first.' : 'Add the bot token and detect your chat first.');
    }
    const ok = await this.deliver(c, { title: 'Pilot · Test', body: 'Notifications are working. This is how Pilot will reach you.' }, false);
    this.deps.changed();
    if (!ok) throw new Error(this.d.status[c]?.lastError ?? 'Sending failed.');
  }

  private async deliver(c: NotifyChannel, f: Formatted, urgent: boolean): Promise<boolean> {
    const status = (this.d.status[c] ??= {});
    try {
      if (c === 'desktop') this.deps.desktop(f);
      else if (c === 'ntfy') await this.sendNtfy(f, urgent);
      else await this.sendTelegram(f);
      if (PHONE.includes(c)) this.d.phoneTimes = [...this.d.phoneTimes.filter((t) => t > Date.now() - HOUR), Date.now()];
      Object.assign(status, { lastSentAt: Date.now(), lastError: undefined });
      return true;
    } catch (e) {
      status.lastError = errorText(e);
      return false;
    }
  }

  /** JSON publishing, so titles with any characters work. Optional access token for protected topics. */
  private async sendNtfy(f: Formatted, urgent: boolean): Promise<void> {
    const { server, topic } = this.n.ntfy;
    const token = channelSecrets.get('ntfy');
    const res = await fetch(server.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ topic, title: f.title, message: f.body, priority: urgent ? 4 : 3, tags: ['email'] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ntfy answered ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }

  private async sendTelegram(f: Formatted): Promise<void> {
    const token = channelSecrets.get('telegram');
    if (!token) throw new Error('No Telegram bot token saved.');
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.n.telegram.chatId, text: `${f.title}\n${f.body}`, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) throw new Error(`Telegram: ${json.description ?? res.status}`);
  }

  /** After the user messages their bot, find the chat to send to. */
  async detectTelegramChat(): Promise<{ chatId: string; name: string }> {
    const token = channelSecrets.get('telegram');
    if (!token) throw new Error('Save your bot token first.');
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { message?: { chat: { id: number; first_name?: string; title?: string; username?: string } } }[];
    };
    if (!json.ok) throw new Error(`Telegram: ${json.description ?? res.status}`);
    const chat = [...(json.result ?? [])].reverse().find((u) => u.message)?.message?.chat;
    if (!chat) throw new Error('No messages found. Open your bot in Telegram, press Start (or send any message), then try again.');
    return { chatId: String(chat.id), name: chat.title ?? chat.first_name ?? chat.username ?? 'your chat' };
  }

  prune(): void {
    const old = Date.now() - 30 * 24 * HOUR;
    for (const [k, t] of Object.entries(this.d.log)) if (t < old) delete this.d.log[k];
    this.d.held = this.d.held.slice(-200);
  }
}
