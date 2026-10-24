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
  saveRule: (rule) => ipcRenderer.invoke('saveRule', rule),
  deleteRule: (id) => ipcRenderer.invoke('deleteRule', id),
  approve: (id) => ipcRenderer.invoke('approve', id),
  reject: (id) => ipcRenderer.invoke('reject', id),
  undo: (id) => ipcRenderer.invoke('undo', id),
  saveSettings: (patch) => ipcRenderer.invoke('saveSettings', patch),
  listModels: () => ipcRenderer.invoke('listModels'),
  onState: (cb) => {
    const listener = (_e: IpcRendererEvent, state: AppState) => cb(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
