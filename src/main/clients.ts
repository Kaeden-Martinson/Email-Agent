import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Settings } from '../shared/types';

/**
 * OAuth clients that ship with the app (oauth-clients.json next to package.json), so people
 * using Inbox Pilot just click "Sign in". Values in Settings → Advanced override them.
 */
interface Clients {
  google: { clientId: string; clientSecret: string };
  microsoft: { clientId: string; tenant: string };
}

let builtIn: Clients | undefined;

function loadBuiltIn(): Clients {
  if (builtIn) return builtIn;
  let file: Partial<Clients> = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'oauth-clients.json'), 'utf8')) as Partial<Clients>;
  } catch {
    // No file: sign-in for that provider stays unavailable unless Settings provides a client.
  }
  builtIn = {
    google: { clientId: file.google?.clientId ?? '', clientSecret: file.google?.clientSecret ?? '' },
    microsoft: { clientId: file.microsoft?.clientId ?? '', tenant: file.microsoft?.tenant || 'common' },
  };
  return builtIn;
}

export function oauthClients(s: Settings): Clients {
  const b = loadBuiltIn();
  return {
    google: s.google.clientId ? s.google : b.google,
    microsoft: s.microsoft.clientId
      ? { clientId: s.microsoft.clientId, tenant: s.microsoft.tenant || 'common' }
      : b.microsoft,
  };
}
