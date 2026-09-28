import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { log } from './logger';

export interface UpdateState {
  status: 'idle' | 'dev' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';
  current: string;
  version?: string;
  percent?: number;
  error?: string;
}

let state: UpdateState = { status: 'idle', current: app.getVersion() };
let notify: (s: UpdateState) => void = () => undefined;

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch, current: app.getVersion() };
  notify(state);
}

export function getUpdateState(): UpdateState {
  return state;
}

export function initUpdater(onState: (s: UpdateState) => void): void {
  notify = onState;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m: unknown) => log('DEBUG', 'updater', String(m)),
    warn: (m: unknown) => log('WARN', 'updater', String(m)),
    error: (m: unknown) => log('ERROR', 'updater', String(m)),
    debug: () => undefined,
  };

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: undefined }));
  autoUpdater.on('update-available', (i) => {
    log('INFO', 'updater', `Nouvelle version disponible : ${i.version}`);
    set({ status: 'downloading', version: i.version, percent: 0 });
  });
  autoUpdater.on('update-not-available', () => set({ status: 'none', version: undefined }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => {
    log('INFO', 'updater', `Version ${i.version} téléchargée, prête à installer`);
    set({ status: 'ready', version: i.version, percent: 100 });
  });
  autoUpdater.on('error', (e) => {
    log('WARN', 'updater', `Mise à jour impossible : ${e.message}`);
    set({ status: 'error', error: e.message });
  });
}

export async function checkForUpdate(): Promise<UpdateState> {
  if (!app.isPackaged) {
    set({ status: 'dev' });
    return state;
  }
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    /* déjà remonté par l'évènement 'error' */
  }
  return state;
}

export function installUpdate(): void {
  if (state.status !== 'ready') return;
  log('INFO', 'updater', `Installation de la version ${state.version}`);
  autoUpdater.quitAndInstall(false, true);
}
