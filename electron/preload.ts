import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { InternPulseApi } from '../shared/api';
import type { ApplyResult } from '../shared/types';

type Listener = (...args: unknown[]) => void;

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, ...payload: unknown[]) => listener(payload[0] as T);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: InternPulseApi = {
  versions: () => invoke('app:versions'),
  openExternal: (url: string) => invoke('app:openExternal', url),

  getSettings: () => invoke('settings:get'),
  setSettings: (patch: Record<string, string>) => invoke('settings:set', patch),

  getProfile: () => invoke('profile:get'),
  ensureProfile: () => invoke('profile:ensure'),
  updateProfile: (patch: Record<string, unknown>) => invoke('profile:update', patch),

  uploadDocument: (payload: { kind: 'RESUME' | 'COVER_LETTER'; filename: string; dataBase64: string }) =>
    invoke('documents:upload', payload),
  listDocuments: () => invoke('documents:list'),
  reparseDocument: (id: string) => invoke('documents:reparse', id),
  deleteDocument: (id: string) => invoke('documents:delete', id),

  listJobs: (filter?: Record<string, unknown>) => invoke('jobs:list', filter ?? {}),
  searchJobs: (request: Record<string, unknown>) => invoke('jobs:search', request),
  updateJob: (id: string, patch: Record<string, unknown>) => invoke('jobs:update', { id, patch }),
  approveJobs: (jobIds: string[]) => invoke('jobs:approve', jobIds),

  runApplications: (payload: { jobIds: string[]; headless?: boolean; delayMs?: number }) =>
    invoke('applications:run', payload),
  listApplications: () => invoke('applications:list'),
  updateApplicationStatus: (id: string, status: string, detail?: string) =>
    invoke('applications:updateStatus', { id, status, detail }),

  outlookAccount: () => invoke('outlook:account'),
  outlookSignIn: () => invoke('outlook:signIn'),
  outlookSignOut: () => invoke('outlook:signOut'),
  outlookSync: () => invoke('outlook:sync'),
  onOutlookDeviceCode: (listener: (message: string) => void) => subscribe<string>('outlook:deviceCode', listener),
  onApplicationsProgress: (listener: (results: ApplyResult[]) => void) =>
    subscribe<ApplyResult[]>('applications:progress', listener),

  testGemini: () => invoke('ai:test'),
  getStats: () => invoke('stats:get'),
  getSyncRuns: () => invoke('sync:runs'),
};

export type { InternPulseApi };

contextBridge.exposeInMainWorld('internpulse', api);
