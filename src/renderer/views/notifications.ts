import type { NotificationSettings, NotifyChannel, NotifyEvent, PrivacyLevel } from '../../shared/types.js';
import { api, btn, h, relTime, run, toast, ui, valueOf } from '../core.js';
import { field } from './settings.js';

// ---- notifications ----

const EVENT_LABEL: Record<NotifyEvent, string> = {
  urgent: 'Important emails',
  reminder: 'Reminders',
  briefing: 'Morning briefing',
  deadline: 'Bills and deadlines (24 hours ahead)',
  followup: 'Follow-ups that are due',
  reply: 'Replies you were waiting on',
  approval: 'Actions waiting for approval',
};

const LEVEL_LABEL: Record<PrivacyLevel, string> = {
  minimal: 'Minimal: no email details',
  sender: 'Sender and subject',
  full: 'Full: include the summary',
};

/** What an important-email notification looks like at each level (example data). */
const LEVEL_PREVIEW: Record<PrivacyLevel, string> = {
  minimal: 'Pilot · Important email — You have an important new email.',
  sender: 'Pilot · Important email — Chase · "Your payment is overdue"',
  full: 'Pilot · Important email — Chase · "Your payment is overdue" — Your card payment of $84.50 is overdue; pay by Friday.',
};

const ns = () => ui.state.settings.notifications;

function saveNotifications(patch: Partial<NotificationSettings>, done?: string): void {
  void run(() => api.saveSettings({ notifications: { ...ns(), ...patch } }), done);
}

function saveChannel<C extends NotifyChannel>(c: C, patch: Partial<NotificationSettings[C]>, done?: string): void {
  saveNotifications({ [c]: { ...ns()[c], ...patch } } as Partial<NotificationSettings>, done);
}

function toggleRow(label: string, checked: boolean, onchange: (v: boolean) => void, hint?: string): HTMLElement {
  return h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked, onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked) }),
    h('span', {}, label, hint ? h('div', { class: 'hint' }, hint) : null));
}

function channelStatusLine(c: NotifyChannel): HTMLElement | null {
  const st = ui.state.notifier.channels[c];
  if (st.lastError) return h('div', { class: 'err' }, `Last attempt failed: ${st.lastError}`);
  if (st.lastSentAt) return h('div', { class: 'hint' }, `Last sent ${relTime(st.lastSentAt)}.`);
  return null;
}

function channelCard(c: NotifyChannel, title: string, intro: HTMLElement | null, setup: (HTMLElement | null)[]): HTMLElement {
  const ch = ns()[c];
  const level = h('select', { onchange: (e: Event) => saveChannel(c, { level: (e.target as HTMLSelectElement).value as PrivacyLevel }) },
    (Object.keys(LEVEL_LABEL) as PrivacyLevel[]).map((l) => h('option', { value: l, selected: ch.level === l }, LEVEL_LABEL[l])));
  return h('fieldset', { class: 'notify-card' }, h('legend', {}, title),
    toggleRow(`Send notifications ${c === 'desktop' ? 'on this PC' : `with ${title}`}`, ch.enabled, (v) => saveChannel(c, { enabled: v })),
    intro,
    ch.enabled ? h('div', {},
      ...setup,
      field('How much to show', level),
      h('div', { class: 'preview' }, h('span', { class: 'hint' }, 'Example: '), LEVEL_PREVIEW[ch.level]),
      c !== 'desktop' && ch.level !== 'minimal'
        ? h('div', { class: 'err' },
            `At this level, email senders and subjects${ch.level === 'full' ? ' and summaries' : ''} pass through ${c === 'ntfy' ? (ns().ntfy.server.includes('ntfy.sh') ? 'the public ntfy.sh servers' : 'your ntfy server') : "Telegram's servers"}. Everything else in Pilot stays on this PC. Keep "Minimal" unless you're comfortable with that.`)
        : null,
      h('div', { class: 'field' }, h('label', {}, 'Notify me about'),
        h('div', { class: 'events' }, (Object.keys(EVENT_LABEL) as NotifyEvent[]).map((ev) =>
          toggleRow(EVENT_LABEL[ev], ch.events[ev], (v) => saveChannel(c, { events: { ...ch.events, [ev]: v } }))))),
      h('div', { class: 'row' }, btn('Send a test', () => void run(() => api.testNotification(c), 'Test sent. Check your device.'))),
      channelStatusLine(c)) : null);
}

function secretField(c: 'ntfy' | 'telegram', label: string, hint: string): HTMLElement {
  const has = ui.state.notifier.channels[c].hasSecret;
  const input = h('input', { type: 'password', placeholder: has ? 'Saved (hidden). Type to replace.' : '', autocomplete: 'off' });
  return field(label, h('div', { class: 'row' }, input,
    btn('Save', () => void run(async () => { await api.setChannelSecret(c, input.value); input.value = ''; }, 'Saved securely on this PC')),
    has ? btn('Remove', () => void run(() => api.setChannelSecret(c, ''), 'Removed'), 'ghost') : null), hint);
}

function randomTopic(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `pilot-${[...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16)}`;
}

export function renderNotifications(): HTMLElement {
  const n = ns();
  const b = ui.state.settings.briefing;
  const wrap = h('div', { class: 'settings' });

  wrap.append(
    h('fieldset', {}, h('legend', {}, 'All notifications'),
      toggleRow('Notifications on', n.enabled, (v) => saveNotifications({ enabled: v }), 'Turn everything off here; your settings below are kept.'),
      ui.state.notifier.held ? h('div', { class: 'hint' }, `${ui.state.notifier.held} notification${ui.state.notifier.held === 1 ? ' is' : 's are'} held and will arrive as one summary after quiet hours.`) : null),

    h('fieldset', {}, h('legend', {}, 'Quiet hours'),
      toggleRow('Hold notifications during quiet hours', n.quiet.enabled, (v) => saveNotifications({ quiet: { ...n.quiet, enabled: v } }),
        'Anything that comes in is sent as one short summary when quiet hours end.'),
      h('div', { class: 'row' },
        field('From', h('input', { type: 'time', value: n.quiet.start, onchange: (e: Event) => saveNotifications({ quiet: { ...n.quiet, start: valueOf(e) || '22:00' } }) })),
        field('Until', h('input', { type: 'time', value: n.quiet.end, onchange: (e: Event) => saveNotifications({ quiet: { ...n.quiet, end: valueOf(e) || '07:00' } }) }))),
      toggleRow('Let important emails through anyway', n.quiet.allowUrgent, (v) => saveNotifications({ quiet: { ...n.quiet, allowUrgent: v } }))),

    h('fieldset', {}, h('legend', {}, 'Morning briefing'),
      toggleRow('Send a daily briefing', b.enabled, (v) => void run(() => api.saveSettings({ briefing: { ...b, enabled: v } }))),
      h('div', { class: 'row' },
        field('Time', h('input', { type: 'time', value: b.time, onchange: (e: Event) => void run(() => api.saveSettings({ briefing: { ...b, time: valueOf(e) || '08:00' } })) })),
        field('Days', h('select', { onchange: (e: Event) => void run(() => api.saveSettings({ briefing: { ...b, days: (e.target as HTMLSelectElement).value as 'everyday' | 'weekdays' } })) },
          h('option', { value: 'everyday', selected: b.days === 'everyday' }, 'Every day'),
          h('option', { value: 'weekdays', selected: b.days === 'weekdays' }, 'Weekdays only')))),
      h('div', { class: 'field' }, h('label', {}, 'Include'),
        (Object.entries({ urgent: 'What needs you', deadlines: 'Bills and deadlines', followups: 'Follow-ups', approvals: 'Approvals waiting' }) as [keyof typeof b.sections, string][]).map(([k, label]) =>
          toggleRow(label, b.sections[k], (v) => void run(() => api.saveSettings({ briefing: { ...b, sections: { ...b.sections, [k]: v } } }))))),
      h('div', { class: 'hint' }, 'Which devices get the briefing is set per channel below ("Morning briefing"). On phones at Minimal or Sender level, the briefing shows counts only.')),

    channelCard('desktop', 'This PC', null, []),

    channelCard('ntfy', 'ntfy (phone)',
      h('p', { class: 'hint' },
        'Free push notifications to the ntfy app (Android, iPhone). Install ntfy on your phone and subscribe to the topic below. ntfy.sh is a public relay: anyone who knows the topic name can read it, so Pilot makes a hard-to-guess name and the default "Minimal" level sends no email details. For fully private delivery, run your own ntfy server and enter its address.'),
      [
        field('Server', h('input', { type: 'text', value: n.ntfy.server, onchange: (e: Event) => saveChannel('ntfy', { server: valueOf(e).trim() || 'https://ntfy.sh' }) })),
        field('Topic', h('div', { class: 'row' },
          h('input', { type: 'text', value: n.ntfy.topic, placeholder: 'pilot-…', onchange: (e: Event) => saveChannel('ntfy', { topic: valueOf(e).trim().replace(/[^\w-]/g, '').slice(0, 64) }) }),
          btn('Generate', () => saveChannel('ntfy', { topic: randomTopic() }, 'New topic set. Subscribe to it in the ntfy app.'))),
          n.ntfy.topic ? `In the ntfy app, tap + and subscribe to "${n.ntfy.topic}"${n.ntfy.server !== 'https://ntfy.sh' ? ` on ${n.ntfy.server}` : ''}.` : 'Generate a topic, then subscribe to it in the ntfy app.'),
        secretField('ntfy', 'Access token (optional)', 'Only needed for a protected topic or your own server. Stored encrypted on this PC.'),
        field('Phone notifications per hour', h('input', { type: 'number', value: String(n.maxPerHour), onchange: (e: Event) => saveNotifications({ maxPerHour: Math.max(1, Math.min(60, Number(valueOf(e)) || 10)) }) }),
          'Beyond this, the rest arrive together as one summary. Applies to ntfy and Telegram together.'),
      ]),

    channelCard('telegram', 'Telegram (phone)',
      h('p', { class: 'hint' }, 'Messages from your own Telegram bot. They pass through Telegram\'s servers, so keep "Minimal" unless you are comfortable with that.'),
      [
        h('ol', { class: 'steps' },
          h('li', {}, 'In Telegram, message @BotFather, send /newbot, and copy the token it gives you.'),
          h('li', {}, 'Paste the token below and save.'),
          h('li', {}, 'Open your new bot in Telegram and press Start.'),
          h('li', {}, 'Click "Find my chat".')),
        secretField('telegram', 'Bot token', 'Stored encrypted on this PC; never shown again.'),
        field('Chat', h('div', { class: 'row' },
          h('span', { class: 'hint' }, n.telegram.chatId ? `Connected (chat ${n.telegram.chatId})` : 'Not connected yet'),
          btn('Find my chat', () => void run(async () => {
            const r = await api.detectTelegramChat();
            toast(`Connected to ${r.name}.`);
          })))),
      ]),
  );
  return wrap;
}
