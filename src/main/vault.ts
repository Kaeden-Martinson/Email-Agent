import { safeStorage } from 'electron';

// OS-backed encryption (DPAPI on Windows, Keychain on macOS) through Electron's asynchronous
// safeStorage API. Data written by the older synchronous API decrypts here too.

let available: boolean | undefined;

export async function vaultAvailable(): Promise<boolean> {
  if (available === undefined) {
    try {
      available = await safeStorage.isAsyncEncryptionAvailable();
    } catch {
      available = false;
    }
  }
  return available;
}

export function encryptText(text: string): Promise<Buffer> {
  return safeStorage.encryptStringAsync(text);
}

/** `reencrypt` means the OS rotated its key: write the data again so it uses the new one. */
export async function decryptText(buf: Buffer): Promise<{ text: string; reencrypt: boolean }> {
  const r = await safeStorage.decryptStringAsync(buf);
  return { text: r.result, reencrypt: r.shouldReEncrypt };
}
