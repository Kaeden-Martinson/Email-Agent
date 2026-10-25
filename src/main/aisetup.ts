// First-run AI setup on a new PC: find or install Ollama, then download a model that fits the PC.
// Every step is started by the user from the setup screen. The Ollama installer comes only from
// Ollama's official download and must carry Ollama Inc.'s valid Windows code signature before it runs.
import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { AiSetupStatus } from '../shared/types';
import { listModels } from './ai/ollama';
import { installedChoice, recommendModel } from './core/aimodel';
import { log } from './logger';

const run = promisify(execFile);
const INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';
const SIGNER = /^CN=Ollama Inc\.,/;

const ollamaApp = () => path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama app.exe');

/** Graphics memory from NVIDIA's tool when present; undefined otherwise (RAM decides then). */
async function vramGB(): Promise<number | undefined> {
  try {
    const { stdout } = await run('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { timeout: 5000, windowsHide: true });
    const mb = Math.max(...stdout.split(/\r?\n/).map(Number).filter((n) => n > 0));
    return Number.isFinite(mb) ? Math.round((mb / 1024) * 10) / 10 : undefined;
  } catch {
    return undefined;
  }
}

/** Throws unless the file has a valid Windows code signature from Ollama Inc. */
export async function verifyOllamaSignature(file: string): Promise<void> {
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`],
    { timeout: 60_000, windowsHide: true },
  );
  const [sigStatus, subject = ''] = stdout.trim().split('|');
  if (sigStatus !== 'Valid' || !SIGNER.test(subject)) {
    log.warn('ollama.signature_rejected', { status: sigStatus });
    throw new Error("The downloaded installer isn't signed by Ollama, so Lodestar didn't run it.");
  }
}

export class AiSetup {
  progress?: AiSetupStatus['progress'];
  private vram?: number | null;

  constructor(
    private readonly url: () => string,
    private readonly changed: () => void,
  ) {}

  async status(): Promise<AiSetupStatus> {
    if (this.vram === undefined) this.vram = (await vramGB()) ?? null;
    const ramGB = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
    const rec = recommendModel(ramGB, this.vram ?? undefined);
    let models: string[] | undefined;
    try {
      models = await listModels(this.url());
    } catch {
      models = undefined;
    }
    const ollama = models ? 'running' : fs.existsSync(ollamaApp()) ? 'stopped' : 'missing';
    const usable = models ? installedChoice(models, rec.model) : undefined;
    return { ollama, ramGB, vramGB: this.vram ?? undefined, recommended: rec, usable, ready: !!usable, progress: this.progress };
  }

  /** Starts the installed Ollama tray app and waits up to 30 s for it to answer. */
  async start(): Promise<void> {
    if (!fs.existsSync(ollamaApp())) throw new Error('Ollama is not installed yet.');
    spawn(ollamaApp(), [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    for (let i = 0; i < 30; i++) {
      try {
        await listModels(this.url());
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw new Error("Ollama didn't start. Open it from the Start menu, then try again.");
  }

  /** Downloads Ollama's official installer, checks its signature, installs it for this user, starts it. */
  async installOllama(): Promise<void> {
    if (process.platform !== 'win32') throw new Error('Automatic install is for Windows. Get Ollama from ollama.com.');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-ollama-'));
    const file = path.join(dir, 'OllamaSetup.exe');
    try {
      this.setProgress('Downloading Ollama', 0);
      const res = await fetch(INSTALLER_URL, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`The Ollama download failed (${res.status}).`);
      const total = Number(res.headers.get('content-length')) || 0;
      const out = fs.createWriteStream(file);
      let got = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.byteLength;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        if (total) this.setProgress('Downloading Ollama', Math.round((got / total) * 100));
      }
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));

      this.setProgress('Checking the download is genuine', undefined);
      await verifyOllamaSignature(file);

      this.setProgress('Installing Ollama', undefined);
      await run(file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { timeout: 10 * 60_000, windowsHide: true });
      log.info('ollama.installed');
      this.setProgress('Starting Ollama', undefined);
      await this.start();
    } finally {
      this.progress = undefined;
      this.changed();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Downloads a model through Ollama, reporting progress. */
  async pull(model: string): Promise<void> {
    if (!/^[\w.:/-]{2,80}$/.test(model)) throw new Error('That model name looks invalid.');
    try {
      this.setProgress(`Downloading the AI model (${model})`, 0);
      const res = await fetch(new URL('/api/pull', this.url()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
      });
      if (!res.ok || !res.body) throw new Error(`Couldn't download ${model} (${res.status}).`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const j = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
          if (j.error) throw new Error(`Couldn't download ${model}: ${j.error}`);
          if (j.total && j.completed !== undefined) this.setProgress(`Downloading the AI model (${model})`, Math.round((j.completed / j.total) * 100));
        }
      }
      log.info('model.pulled', { model });
    } finally {
      this.progress = undefined;
      this.changed();
    }
  }

  private lastEmit = 0;
  private setProgress(step: string, percent: number | undefined): void {
    this.progress = { step, percent };
    // Throttled: a big download reports thousands of chunks.
    if (Date.now() - this.lastEmit > 400 || percent === 100 || percent === undefined) {
      this.lastEmit = Date.now();
      this.changed();
    }
  }
}
