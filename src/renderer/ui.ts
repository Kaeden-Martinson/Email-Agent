// Shared building blocks for every screen, so classes and markup live in one place.
import { h, type Child } from './core.js';
import { icon, type IconName } from './icons.js';

export function button(label: string, o: { onClick: () => void; kind?: 'default' | 'primary' | 'ghost' | 'danger'; icon?: IconName; disabled?: boolean; tiny?: boolean; title?: string }): HTMLButtonElement {
  const cls = ['g-btn', o.kind && o.kind !== 'default' ? o.kind : '', o.tiny ? 'tiny' : ''].filter(Boolean).join(' ');
  return h('button', { class: cls, type: 'button', onclick: o.onClick, disabled: !!o.disabled, title: o.title }, o.icon ? icon(o.icon, 14) : null, label);
}

export function segmented<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void, o: { id?: string; disabled?: boolean } = {}): HTMLElement {
  return h('div', { class: 'g-seg', role: 'radiogroup', id: o.id },
    options.map((x) => h('button', { type: 'button', class: x.value === value ? 'on' : '', role: 'radio', 'aria-checked': String(x.value === value), 'data-value': x.value, disabled: !!o.disabled, onclick: () => onChange(x.value) }, x.label)));
}

/** Marks `value` as the chosen segment of a segmented control in place (no redraw). */
export function markSegment(seg: Element, value: string): void {
  seg.querySelectorAll<HTMLButtonElement>('button[data-value]').forEach((b) => {
    const on = b.dataset.value === value;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
}

/** Makes a clickable row reachable with Tab and usable with Enter or Space, like a button. */
function clickable(onClick: (() => void) | undefined): Record<string, unknown> {
  if (!onClick) return {};
  return {
    tabIndex: 0,
    role: 'button',
    onclick: onClick,
    onkeydown: (e: KeyboardEvent) => {
      // Only the row itself: Enter on a button inside the row is that button's business.
      if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      onClick();
    },
  };
}

export function toggle(checked: boolean, onChange: (v: boolean) => void, label: string): HTMLButtonElement {
  return h('button', { type: 'button', class: `g-toggle${checked ? ' on' : ''}`, role: 'switch', 'aria-checked': String(checked), 'aria-label': label, onclick: () => onChange(!checked) }, h('i', {}));
}

export function tabs<T extends string>(items: { id: T; label: string; count?: number }[], active: T, onSelect: (id: T) => void, right?: Child): HTMLElement {
  return h('div', { class: 'g-tabs', role: 'tablist' },
    items.map((t) => h('button', { type: 'button', role: 'tab', class: `g-tab${t.id === active ? ' on' : ''}`, 'aria-selected': String(t.id === active), onclick: () => onSelect(t.id) }, t.label, t.count !== undefined ? h('i', {}, String(t.count)) : null)),
    right ? h('span', { class: 'g-spacer' }) : null, right ?? null);
}

export function card(children: Child[], o: { pad?: boolean; selected?: boolean } = {}): HTMLElement {
  return h('div', { class: `g-card${o.pad === false ? '' : ' pad'}${o.selected ? ' sel' : ''}` }, ...children);
}

export function sectionTitle(text: string, count?: number): HTMLElement {
  return h('div', { class: 'g-sec' }, text, count !== undefined ? h('span', { class: 'cnt' }, String(count)) : null);
}

export function listRow(o: { dot?: 'p1' | 'p2' | 'low' | null; title: Child | Child[]; sub?: Child | Child[]; right?: Child; selected?: boolean; onClick?: () => void; key?: string }): HTMLElement {
  return h('div', { class: `g-row${o.onClick ? ' click' : ''}${o.selected ? ' sel' : ''}`, 'data-key': o.key, ...clickable(o.onClick) },
    o.dot === null ? h('span', {}) : h('span', { class: `g-pri ${o.dot ?? 'low'}` }),
    h('div', { style: 'min-width:0' }, h('div', { class: 't' }, o.title), o.sub ? h('div', { class: 's' }, o.sub) : null),
    h('span', { class: 'r' }, o.right ?? null));
}

export function table(columns: { label: string; align?: 'right' }[], rows: { cells: Child[]; selected?: boolean; onClick?: () => void }[]): HTMLTableElement {
  return h('table', { class: 'g-table' },
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.align === 'right' ? 'r' : '' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', { class: `${r.onClick ? 'click' : ''}${r.selected ? ' sel' : ''}`, ...clickable(r.onClick) },
      r.cells.map((cell, i) => h('td', { class: columns[i]?.align === 'right' ? 'r' : '' }, cell))))));
}

export function stats(items: { value: string; label: string }[]): HTMLElement {
  return h('div', { class: 'g-stats' }, items.map((s) => h('div', {}, h('b', {}, s.value), h('span', {}, s.label))));
}

export function chip(text: string, tone: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' = 'neutral'): HTMLElement {
  return h('span', { class: `g-chip${tone === 'neutral' ? '' : ` ${tone}`}` }, text);
}

export function banner(kind: 'info' | 'warn' | 'danger' | 'ok', body: Child[], actions: Node[] = []): HTMLElement {
  return h('div', { class: `g-banner${kind === 'info' ? '' : ` ${kind}`}`, role: kind === 'danger' ? 'alert' : 'status' },
    h('div', { class: 'body' }, ...body), actions.length ? h('div', { class: 'acts' }, ...actions) : null);
}

export function emptyState(text: string, action?: Node): HTMLElement {
  return h('div', { class: 'g-empty' }, h('div', {}, text), action ? h('div', { class: 'g-acts', style: 'justify-content:center' }, action) : null);
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'g-field' }, h('label', {}, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function progress(percent?: number): HTMLElement {
  return percent === undefined
    ? h('div', { class: 'g-progress indet' }, h('i', {}))
    : h('div', { class: 'g-progress', role: 'progressbar', 'aria-valuenow': String(percent) }, h('i', { style: `width:${Math.max(0, Math.min(100, percent))}%` }));
}

export function skeleton(lines = 3): HTMLElement {
  return h('div', { class: 'g-card pad' }, Array.from({ length: lines }, (_, i) => h('div', { class: 'g-skel', style: `width:${90 - i * 15}%` })));
}
