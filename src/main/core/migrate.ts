// Versioned migrations for the saved state, so older files keep working after updates.
// Each step is small, pure and tested; the store runs them in order on load.
import { DEFAULT_PERMISSIONS, type Account } from '../../shared/types';

export const SCHEMA_VERSION = 2;

type Raw = Record<string, unknown> & { version?: number; schemaVersion?: number };

const MIGRATIONS: Record<number, (s: Raw) => Raw> = {
  // v1 → v2: collections added across stages 3–8; accounts gained providerName, watching and permissions.
  1: (s) => ({
    ...s,
    accounts: ((s.accounts as Account[] | undefined) ?? []).map((a) => ({
      ...a,
      providerName: a.providerName ?? (a.kind === 'gmail' ? 'Gmail' : a.kind === 'outlook' ? 'Outlook' : 'Email'),
      watching: a.watching ?? true,
      permissions: { ...DEFAULT_PERMISSIONS, ...a.permissions },
    })),
    rules: s.rules ?? [],
    corrections: s.corrections ?? [],
    activity: s.activity ?? [],
    followUps: s.followUps ?? [],
    commitments: s.commitments ?? [],
    reminders: s.reminders ?? [],
    items: s.items ?? [],
    unsubscribed: s.unsubscribed ?? {},
    owedCheckedAt: s.owedCheckedAt ?? {},
    notify: s.notify ?? { log: {}, held: [], phoneTimes: [], status: {} },
    repliedThreads: s.repliedThreads ?? [],
    sendLog: s.sendLog ?? [],
    updates: s.updates ?? {},
  }),
};

/** Brings a saved state up to the current schema. Refuses files from a newer version of the app. */
export function migrate(raw: Raw): Raw {
  let s = { ...raw };
  let v = Number(s.schemaVersion ?? s.version ?? 1);
  if (v > SCHEMA_VERSION) {
    throw new Error(`This data was saved by a newer version of Lodestar (schema ${v}). Update Lodestar to open it.`);
  }
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from schema ${v}.`);
    s = step(s);
    v++;
  }
  return { ...s, schemaVersion: SCHEMA_VERSION, version: 1 };
}
