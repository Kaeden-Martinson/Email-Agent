import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import * as path from 'node:path';
import type {
  AccountPatch,
  Briefing,
  Commitment,
  ConnectRequest,
  CorrectionKind,
  FollowUp,
  KeyItem,
  Reminder,
  ReminderTarget,
  Settings,
  Update,
  UpdateAction,
} from '../shared/types';
import { seedDemo } from './demo';
import { Engine } from './engine';
import { cancelAuthorize } from './oauth';
import { Store } from './store';

const DEMO = process.argv.includes('--demo');
if (DEMO) app.setPath('userData', path.join(app.getPath('userData'), 'demo'));

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

/** A small blue disc, drawn in code so the app ships without image assets. */
function makeIcon(size = 32): Electron.NativeImage {
  const px = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const r = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const alpha = Math.min(1, Math.max(0, r - Math.hypot(x - c, y - c) + 0.5));
      const i = (y * size + x) * 4; // BGRA
      px[i] = 235;
      px[i + 1] = 99;
      px[i + 2] = 37;
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBitmap(px, { width: size, height: size });
}

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(icon: Electron.NativeImage): void {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 500,
    title: DEMO ? 'Inbox Pilot (demo)' : 'Inbox Pilot',
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '../web/renderer/index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Closing the window keeps the assistant running in the tray.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

function createTray(icon: Electron.NativeImage, engine: Engine): void {
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Inbox Pilot');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Inbox Pilot', click: showWindow },
      { label: 'Check mail now', click: () => void engine.sync() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', showWindow);
}

function openHttps(url: string): Promise<void> {
  if (!/^https:\/\//.test(url)) throw new Error('Refusing to open a non-https link');
  return shell.openExternal(url);
}

function registerIpc(engine: Engine): void {
  ipcMain.handle('getState', () => engine.state());
  ipcMain.handle('discover', (_e, email: string) => engine.discover(String(email)));
  ipcMain.handle('connect', (_e, req: ConnectRequest) => {
    if (!['gmail', 'outlook', 'imap'].includes(req?.kind)) throw new Error('Unknown provider');
    return engine.connect(req);
  });
  ipcMain.handle('cancelSignIn', () => cancelAuthorize());
  ipcMain.handle('updateAccount', (_e, id: string, patch: AccountPatch) => engine.updateAccount(String(id), patch));
  ipcMain.handle('removeAccount', (_e, id: string) => engine.removeAccount(String(id)));
  ipcMain.handle('syncNow', () => engine.sync());
  ipcMain.handle('act', (_e, key: string, action: UpdateAction) => engine.act(String(key), action));
  ipcMain.handle('sendReply', (_e, key: string, text: string, send: boolean) =>
    engine.sendReply(String(key), String(text), !!send),
  );
  ipcMain.handle('redraft', (_e, key: string) => engine.redraft(String(key)));
  ipcMain.handle('open', (_e, key: string) => openHttps(engine.webLink(String(key))));
  ipcMain.handle('openUrl', (_e, url: string) => openHttps(String(url)));
  ipcMain.handle('unsubscribe', (_e, accountId: string, sender: string) => engine.unsubscribe(String(accountId), String(sender)));
  ipcMain.handle('briefNow', () => engine.brief());
  ipcMain.handle('correct', (_e, key: string, kind: CorrectionKind, scope: 'once' | 'sender' | 'domain') => {
    if (!['more', 'less', 'junk'].includes(kind) || !['once', 'sender', 'domain'].includes(scope)) throw new Error('Invalid correction');
    return engine.correct(String(key), kind, scope);
  });
  ipcMain.handle('saveRule', (_e, rule: Parameters<Engine['saveRule']>[0]) => engine.saveRule(rule));
  ipcMain.handle('deleteRule', (_e, id: string) => engine.deleteRule(String(id)));
  ipcMain.handle('approve', (_e, id: string) => engine.approve(String(id)));
  ipcMain.handle('reject', (_e, id: string) => engine.reject(String(id)));
  ipcMain.handle('undo', (_e, id: string) => engine.undo(String(id)));
  ipcMain.handle('previewWhen', (_e, phrase: string) => engine.previewWhen(String(phrase)));
  ipcMain.handle('remind', (_e, target: ReminderTarget, phrase: string) => {
    if (!target || !['update', 'followup', 'commitment', 'item'].includes(target.kind)) throw new Error('Invalid reminder target');
    return engine.remind(target, String(phrase));
  });
  ipcMain.handle('cancelReminder', (_e, id: string) => engine.cancelReminder(String(id)));
  ipcMain.handle('setFollowUp', (_e, id: string, status: FollowUp['status']) => {
    if (!['waiting', 'replied', 'done', 'dismissed'].includes(status)) throw new Error('Invalid status');
    return engine.setFollowUp(String(id), status);
  });
  ipcMain.handle('setCommitment', (_e, id: string, status: Commitment['status']) => {
    if (!['open', 'done', 'dismissed'].includes(status)) throw new Error('Invalid status');
    return engine.setCommitment(String(id), status);
  });
  ipcMain.handle('draftNudge', (_e, id: string) => engine.draftNudge(String(id)));
  ipcMain.handle('search', (_e, q: string) => engine.search(String(q)));
  ipcMain.handle('ask', (_e, q: string) => engine.ask(String(q)));
  ipcMain.handle('enableSemantic', (_e, model: string) => engine.enableSemantic(String(model)));
  ipcMain.handle('setItem', (_e, id: string, status: KeyItem['status']) => {
    if (!['open', 'done', 'dismissed'].includes(status)) throw new Error('Invalid status');
    return engine.setItem(String(id), status);
  });
  ipcMain.handle('saveSettings', (_e, patch: Partial<Settings>) => engine.saveSettings(patch));
  ipcMain.handle('listModels', () => engine.listModels());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    app.setAppUserModelId('com.inboxpilot.app');
    const store = new Store();
    if (DEMO) seedDemo(store);
    const engine = new Engine(store, DEMO);
    const icon = makeIcon();

    registerIpc(engine);
    createWindow(icon);
    createTray(icon, engine);

    // Coalesce bursts of changes into one push to the renderer.
    let pending: NodeJS.Timeout | undefined;
    engine.on('changed', () => {
      clearTimeout(pending);
      pending = setTimeout(() => win?.webContents.send('state', engine.state()), 100);
    });
    engine.on('notify', (u: Update) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: u.message.subject || 'Important email', body: u.triage?.summary ?? '' });
      n.on('click', showWindow);
      n.show();
    });

    engine.on('reminder', (r: Reminder) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: 'Reminder', body: r.title });
      n.on('click', showWindow);
      n.show();
    });
    engine.on('briefing', (b: Briefing) => {
      if (!Notification.isSupported()) return;
      const name = store.data.settings.userName;
      const n = new Notification({ title: name ? `Good morning, ${name}` : 'Your morning briefing', body: b.text });
      n.on('click', showWindow);
      n.show();
    });

    app.on('before-quit', () => {
      quitting = true;
      store.flush();
    });
    engine.start();
  });
  // Stay alive in the tray when the window is closed.
  app.on('window-all-closed', () => {});
}
