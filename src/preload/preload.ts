import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Api, AppState } from '../shared/types';

const api: Api = {
  getState: () => ipcRenderer.invoke('getState'),
  discover: (email) => ipcRenderer.invoke('discover', email),
  connect: (req) => ipcRenderer.invoke('connect', req),
  cancelSignIn: () => ipcRenderer.invoke('cancelSignIn'),
  updateAccount: (id, patch) => ipcRenderer.invoke('updateAccount', id, patch),
  removeAccount: (id) => ipcRenderer.invoke('removeAccount', id),
  syncNow: () => ipcRenderer.invoke('syncNow'),
  act: (key, action) => ipcRenderer.invoke('act', key, action),
  sendReply: (key, text, send) => ipcRenderer.invoke('sendReply', key, text, send),
  redraft: (key) => ipcRenderer.invoke('redraft', key),
  open: (key) => ipcRenderer.invoke('open', key),
  openUrl: (url) => ipcRenderer.invoke('openUrl', url),
  unsubscribe: (accountId, sender) => ipcRenderer.invoke('unsubscribe', accountId, sender),
  briefNow: () => ipcRenderer.invoke('briefNow'),
  correct: (key, kind, scope) => ipcRenderer.invoke('correct', key, kind, scope),
  doneMany: (keys) => ipcRenderer.invoke('doneMany', keys),
  dismissSuggestion: (s) => ipcRenderer.invoke('dismissSuggestion', s),
  parseRule: (text) => ipcRenderer.invoke('parseRule', text),
  saveRule: (rule) => ipcRenderer.invoke('saveRule', rule),
  deleteRule: (id) => ipcRenderer.invoke('deleteRule', id),
  approve: (id) => ipcRenderer.invoke('approve', id),
  reject: (id) => ipcRenderer.invoke('reject', id),
  undo: (id) => ipcRenderer.invoke('undo', id),
  previewWhen: (phrase) => ipcRenderer.invoke('previewWhen', phrase),
  remind: (target, phrase) => ipcRenderer.invoke('remind', target, phrase),
  cancelReminder: (id) => ipcRenderer.invoke('cancelReminder', id),
  setFollowUp: (id, status) => ipcRenderer.invoke('setFollowUp', id, status),
  setCommitment: (id, status) => ipcRenderer.invoke('setCommitment', id, status),
  draftNudge: (id) => ipcRenderer.invoke('draftNudge', id),
  setItem: (id, status) => ipcRenderer.invoke('setItem', id, status),
  search: (q) => ipcRenderer.invoke('search', q),
  ask: (q) => ipcRenderer.invoke('ask', q),
  enableSemantic: (model) => ipcRenderer.invoke('enableSemantic', model),
  testNotification: (channel) => ipcRenderer.invoke('testNotification', channel),
  setChannelSecret: (channel, secret) => ipcRenderer.invoke('setChannelSecret', channel, secret),
  detectTelegramChat: () => ipcRenderer.invoke('detectTelegramChat'),
  getBody: (key) => ipcRenderer.invoke('getBody', key),
  cleanupPreview: (f) => ipcRenderer.invoke('cleanupPreview', f),
  cleanupRun: (f) => ipcRenderer.invoke('cleanupRun', f),
  undoMany: (ids) => ipcRenderer.invoke('undoMany', ids),
  aiStatus: () => ipcRenderer.invoke('aiStatus'),
  aiInstallOllama: () => ipcRenderer.invoke('aiInstallOllama'),
  aiStartOllama: () => ipcRenderer.invoke('aiStartOllama'),
  aiPullModel: () => ipcRenderer.invoke('aiPullModel'),
  learnStyle: () => ipcRenderer.invoke('learnStyle'),
  forgetStyle: () => ipcRenderer.invoke('forgetStyle'),
  snooze: (key, choice) => ipcRenderer.invoke('snooze', key, choice),
  previewSnooze: (choice) => ipcRenderer.invoke('previewSnooze', choice),
  freeTimes: (key) => ipcRenderer.invoke('freeTimes', key),
  replyOptions: (key) => ipcRenderer.invoke('replyOptions', key),
  checkForUpdates: () => ipcRenderer.invoke('checkForUpdates'),
  openFolder: (which) => ipcRenderer.invoke('openFolder', which),
  dismissNotice: () => ipcRenderer.invoke('dismissNotice'),
  saveSettings: (patch) => ipcRenderer.invoke('saveSettings', patch),
  listModels: () => ipcRenderer.invoke('listModels'),
  windowMinimize: () => ipcRenderer.invoke('windowMinimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('windowToggleMaximize'),
  windowClose: () => ipcRenderer.invoke('windowClose'),
  windowIsMaximized: () => ipcRenderer.invoke('windowIsMaximized'),
  onWindowMaximized: (cb) => {
    const listener = (_e: IpcRendererEvent, maximized: boolean) => cb(maximized);
    ipcRenderer.on('window-maximized', listener);
    return () => ipcRenderer.removeListener('window-maximized', listener);
  },
  onState: (cb) => {
    const listener = (_e: IpcRendererEvent, state: AppState) => cb(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
