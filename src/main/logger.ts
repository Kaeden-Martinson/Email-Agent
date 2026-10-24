import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { redact } from './core/redact';

// Structured logs for troubleshooting: one JSON object per line in userData/logs/pilot-YYYY-MM-DD.log.
// Everything passes through redact(), so email content, addresses and credentials never land on disk.

let dir = '';
let echo = false;

export function initLogger(devMode: boolean): void {
  dir = path.join(app.getPath('userData'), 'logs');
  echo = devMode;
  fs.mkdirSync(dir, { recursive: true });
  // Keep two weeks.
  const cutoff = Date.now() - 14 * 86_400_000;
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      // Ignore files we can't inspect.
    }
  }
}

export function logsDir(): string {
  return dir;
}

function write(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(redact(fields) as Record<string, unknown>) });
  if (echo || !dir) console[level === 'info' ? 'log' : level](line);
  if (!dir) return;
  fs.appendFile(path.join(dir, `pilot-${new Date().toISOString().slice(0, 10)}.log`), `${line}\n`, () => {});
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
};
