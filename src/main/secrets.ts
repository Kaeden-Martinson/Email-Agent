import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from './logger';
import { decryptText, encryptText, vaultAvailable } from './vault';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

// OAuth tokens, IMAP app passwords and notification tokens, encrypted with the OS keystore.
// Loaded once at startup (initSecrets); reads are then synchronous, writes are queued and encrypted.
let cache: Record<string, unknown> = {};
let encryptionOk = false;
let writes: Promise<void> = Promise.resolve();

const file = () => path.join(app.getPath('userData'), 'tokens.bin');

export async function initSecrets(): Promise<void> {
  encryptionOk = await vaultAvailable();
  if (!fs.existsSync(file())) return;
  try {
    const { text, reencrypt } = await decryptText(fs.readFileSync(file()));
    cache = JSON.parse(text) as Record<string, unknown>;
    if (reencrypt) queueWrite();
  } catch (e) {
    // Keep the unreadable file for inspection rather than overwriting it.
    const aside = `${file()}.unreadable-${Date.now()}`;
    fs.renameSync(file(), aside);
    log.error('secrets.unreadable', { error: e, keptAs: path.basename(aside) });
    cache = {};
  }
}

function queueWrite(): void {
  const snapshot = JSON.stringify(cache);
  writes = writes
    .then(async () => {
      const tmp = `${file()}.tmp`;
      fs.writeFileSync(tmp, await encryptText(snapshot));
      fs.renameSync(tmp, file());
    })
    .catch((e) => log.error('secrets.write_failed', { error: e }));
}

/** Resolves when pending writes are on disk (call before quitting). */
export function flushSecrets(): Promise<void> {
  return writes;
}

function slot<T>(suffix: string) {
  return {
    get(id: string): T | undefined {
      return cache[id + suffix] as T | undefined;
    },
    set(id: string, value: T): void {
      if (!encryptionOk) throw new Error('OS encryption is unavailable, so secrets will not be stored in plain text.');
      cache[id + suffix] = value;
      queueWrite();
    },
    delete(id: string): void {
      if (!(id + suffix in cache)) return;
      delete cache[id + suffix];
      queueWrite();
    },
  };
}

export const tokens = slot<TokenSet>('');
export const passwords = slot<string>(':password');
/** Notification channel credentials, keyed by channel name ("ntfy", "telegram"). */
export const channelSecrets = slot<string>(':channel-secret');
