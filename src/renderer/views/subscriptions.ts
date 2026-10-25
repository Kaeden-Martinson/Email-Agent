import type { Category, CleanupPreview, Subscription } from '../../shared/types.js';
import { api, btn, h, relTime, render, run, toast, ui } from '../core.js';

// ---- subscriptions ----

export function renderSubscriptions(): HTMLElement {
  const wrap = h('div');
  const subs = ui.state.subscriptions;
  wrap.append(h('p', { class: 'hint' },
    'Newsletters and promotions your Pilot has seen in the last 30 days, busiest first. Turn automatic unsubscribing on per mailbox under Mailboxes → Permissions.'));
  wrap.append(cleanupBox());
  if (!subs.length) {
    wrap.append(h('div', { class: 'empty' }, 'No newsletters or promotions yet.'));
    return wrap;
  }
  for (const s of subs) wrap.append(subscriptionRow(s));
  return wrap;
}

const cleanup = { categories: ['promo', 'newsletter'] as Category[], days: 30, preview: null as CleanupPreview | null, busy: false };

/** "Archive all promotions older than 30 days": preview first, then each archive is logged and undoable. */
function cleanupBox(): HTMLElement {
  const reset = () => { cleanup.preview = null; };
  const cats: [Category, string][] = [['promo', 'Promotions'], ['newsletter', 'Newsletters'], ['notification', 'Notifications'], ['spam', 'Spam']];
  const p = cleanup.preview;
  return h('div', { class: 'banner add-rule' },
    h('h3', {}, 'Bulk cleanup'),
    h('div', { class: 'row wrap' },
      ...cats.map(([c, label]) => h('label', { class: 'check inline' },
        h('input', { type: 'checkbox', checked: cleanup.categories.includes(c), onchange: (e: Event) => {
          cleanup.categories = (e.target as HTMLInputElement).checked ? [...cleanup.categories, c] : cleanup.categories.filter((x) => x !== c);
          reset(); render();
        } }), label)),
      h('select', { onchange: (e: Event) => { cleanup.days = Number((e.target as HTMLSelectElement).value); reset(); render(); } },
        ...[7, 14, 30, 60].map((d) => h('option', { value: String(d), selected: cleanup.days === d }, `older than ${d} days`))),
      btn('Preview', () => void run(async () => {
        cleanup.preview = await api.cleanupPreview({ categories: cleanup.categories, olderThanDays: cleanup.days });
        render();
      }), cleanup.categories.length ? '' : '', !cleanup.categories.length)),
    h('div', { class: 'hint' }, 'Archives only; never deletes. Important emails and emails waiting on your reply are never included. Each archive can be undone.'),
    p
      ? h('div', { class: 'rule-preview' },
          h('strong', {}, p.count ? `${p.count} email${p.count === 1 ? '' : 's'} would be archived` : 'Nothing matches right now.'),
          p.skipped ? h('div', { class: 'hint' }, `${p.skipped} more match in mailboxes where archiving is off; they are left alone.`) : null,
          p.examples.length ? h('ul', { class: 'todos' }, p.examples.map((x) => h('li', {}, `${x.from}: ${x.subject || '(no subject)'}`))) : null,
          p.count
            ? h('div', { class: 'actions' },
                btn(cleanup.busy ? 'Archiving…' : `Archive ${p.count}`, () => {
                  cleanup.busy = true;
                  render();
                  void run(async () => {
                    try {
                      const r = await api.cleanupRun({ categories: cleanup.categories, olderThanDays: cleanup.days });
                      cleanup.preview = null;
                      toast(`Archived ${r.archived}${r.failed ? `, ${r.failed} failed` : ''}`, r.ids.length
                        ? { label: 'Undo all', fn: () => void run(async () => { const n = await api.undoMany(r.ids); toast(`Moved ${n} back to the inbox`); }) }
                        : undefined);
                    } finally {
                      cleanup.busy = false;
                      render();
                    }
                  });
                }, 'primary', cleanup.busy),
                btn('Cancel', () => { reset(); render(); }, 'ghost'))
            : null)
      : null);
}

function subscriptionRow(s: Subscription): HTMLElement {
  const account = ui.state.accounts.find((a) => a.id === s.accountId);
  const how = s.unsubscribe
    ? s.unsubscribe.oneClick ? 'One-click unsubscribe' : s.unsubscribe.mailto ? 'Unsubscribes by email' : 'Unsubscribes on their website'
    : 'No unsubscribe link';
  const action = s.unsubscribedAt
    ? h('span', { class: 'pill off' }, `Unsubscribed ${relTime(s.unsubscribedAt)}`)
    : s.unsubscribe
      ? btn('Unsubscribe', () => void run(async () => {
          const r = await api.unsubscribe(s.accountId, s.sender);
          toast(r.message);
          if (r.openUrl) await api.openUrl(r.openUrl);
        }), 'primary')
      : null;
  return h('div', { class: 'banner sub-row' },
    h('div', { class: 'grow' },
      h('div', {}, h('strong', {}, s.name || s.sender), s.name ? ` · ${s.sender}` : ''),
      h('div', { class: 'hint' },
        `${s.count} email${s.count === 1 ? '' : 's'} in 30 days · last ${relTime(s.lastAt)} · ${how}` +
          (ui.state.accounts.length > 1 && account ? ` · ${account.email}` : '') +
          (s.method ? ` · via ${s.method}` : ''))),
    action);
}
