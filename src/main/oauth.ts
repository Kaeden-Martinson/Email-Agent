import { shell } from 'electron';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TokenSet } from './secrets';

export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  /** Google wants 127.0.0.1; Microsoft's portal registers http://localhost. */
  redirectHost: '127.0.0.1' | 'localhost';
  extraAuthParams?: Record<string, string>;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Rejects the sign-in in progress, if any. */
let cancelCurrent: ((reason: Error) => void) | undefined;

/**
 * Abandons the waiting sign-in. Needed because when the provider blocks a sign-in it shows its
 * own error page and never redirects back, so the loopback server would otherwise wait it out.
 */
export function cancelAuthorize(): void {
  cancelCurrent?.(new Error('Sign-in was cancelled.'));
}

/**
 * Desktop OAuth: authorization-code flow with PKCE and a one-shot loopback server.
 * Opens the provider's sign-in page in the default browser and resolves with tokens.
 */
export async function authorize(cfg: OAuthConfig): Promise<TokenSet> {
  // A new attempt replaces any sign-in still waiting.
  cancelAuthorize();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://${cfg.redirectHost}:${port}/callback`;

  let cancelThis: ((reason: Error) => void) | undefined;
  const codePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Sign-in timed out after 5 minutes.')), 5 * 60_000);
    cancelThis = (reason) => {
      clearTimeout(timeout);
      reject(reason);
    };
    cancelCurrent = cancelThis;
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', redirectUri);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const ok = !error && !!code && url.searchParams.get('state') === state;
      res
        .writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(
          `<!doctype html><title>Lodestar</title><body style="font:16px system-ui;padding:3rem">` +
            (ok
              ? 'Signed in. You can close this tab and go back to Lodestar.'
              : 'Sign-in did not complete. You can close this tab.') +
            '</body>',
        );
      clearTimeout(timeout);
      if (ok) resolve(code);
      else reject(new Error(url.searchParams.get('error_description') ?? error ?? 'Invalid sign-in response.'));
    });
  });
  codePromise.catch(() => {});

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: cfg.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...cfg.extraAuthParams,
  });

  try {
    await shell.openExternal(`${cfg.authUrl}?${params}`);
    const code = await codePromise;
    return await exchange(cfg, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
  } finally {
    if (cancelCurrent === cancelThis) cancelCurrent = undefined;
    server.close();
  }
}

export async function refresh(cfg: OAuthConfig, refreshToken: string): Promise<TokenSet> {
  const t = await exchange(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken });
  return { ...t, refreshToken: t.refreshToken ?? refreshToken };
}

async function exchange(cfg: OAuthConfig, params: Record<string, string>): Promise<TokenSet> {
  const body = new URLSearchParams({ client_id: cfg.clientId, ...params });
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as Record<string, any>;
  if (!res.ok) {
    throw new Error(`Token request failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
  };
}
