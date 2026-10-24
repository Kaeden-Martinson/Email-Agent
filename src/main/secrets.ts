import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

// OAuth tokens and IMAP app passwords, encrypted with the OS keystore (DPAPI on Windows, Keychain on macOS).
let cache: Record<string, unknown> | null = null;

const file = () => path.join(app.getPath('userData'), 'tokens.bin');

function readAll(): Record<string, unknown> {
  if (cache) return cache;
  try {
    cache = JSON.parse(safeStorage.decryptString(fs.readFileSync(file()))) as Record<string, unknown>;
  } catch {
    cache = {};
  }
  return cache;
}

function writeAll(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable, so secrets will not be stored in plain text.');
  }
  fs.writeFileSync(file(), safeStorage.encryptString(JSON.stringify(readAll())));
}

function slot<T>(suffix: string) {
  return {
    get(accountId: string): T | undefined {
      return readAll()[accountId + suffix] as T | undefined;
    },
    set(accountId: string, value: T): void {
      readAll()[accountId + suffix] = value;
      writeAll();
    },
    delete(accountId: string): void {
      delete readAll()[accountId + suffix];
      writeAll();
    },
  };
}

export const tokens = slot<TokenSet>('');
export const passwords = slot<string>(':password');
