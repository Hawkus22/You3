import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { startBridge } from './bridge';
import * as db from './db';
import { currentLogFile, log, onLog, purgeOld } from './logger';
import { dataDir, dirs, ytdlpPath } from './paths';
import * as queue from './queue';
import { getSettings, saveSettings, Settings } from './settings';
import { checkYtdlp, ensureYtdlp, installOrUpdateYtdlp, toolsStatus } from './tools';
import { checkForUpdate, getUpdateState, initUpdater, installUpdate } from './updater';

app.setName('You3');

let win: BrowserWindow | null = null;
let helpWin: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
}

let playou3Declined = false; // « Non » à l'installation : on ne redemande pas avant le prochain lancement

/** Propose d'installer Playou3 (dernière Release GitHub). Retourne true si l'installeur a été lancé. */
async function offerPlayou3Install(): Promise<boolean> {
  const { response } = await dialog.showMessageBox(win!, {
    type: 'question',
    buttons: ['Installer Playou3', "Non, ouvrir l'Explorateur"],
    defaultId: 0,
    cancelId: 1,
    title: 'Playou3',
    message: "Playou3 n'est pas installé.",
    detail: "Playou3 est le lecteur de musique compagnon de You3. Voulez-vous le télécharger et l'installer maintenant ?",
  });
  if (response !== 0) {
    playou3Declined = true;
    return false;
  }
  try {
    const res0 = await fetch('https://api.github.com/repos/Hawkus22/Playou3/releases/latest');
    if (!res0.ok) throw new Error(res0.status === 404 ? "aucune version de Playou3 n'est encore publiée" : `GitHub a répondu ${res0.status}`);
    const rel = (await res0.json()) as { assets?: { name: string; browser_download_url: string }[] };
    const asset = rel.assets?.find((a) => /^Playou3-Setup-.*\.exe$/.test(a.name));
    if (!asset) throw new Error('installeur introuvable dans la dernière Release');
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) throw new Error(`téléchargement refusé (${res.status})`);
    const file = path.join(dirs.tmp(), asset.name);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    log('INFO', 'app', `Installeur Playou3 téléchargé : ${file}`);
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    return true;
  } catch (e) {
    log('WARN', 'app', `Installation de Playou3 impossible : ${(e as Error).message}`);
    await dialog.showMessageBox(win!, {
      type: 'warning',
      title: 'Playou3',
      message: "L'installation automatique a échoué.",
      detail: `${(e as Error).message}\n\nLe fichier va s'ouvrir dans l'Explorateur Windows.`,
    });
    return false;
  }
}

const send = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
};

function createWindow(): void {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: `You3 v${app.getVersion()}`,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    backgroundColor: '#14161c',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Le titre de la page HTML ne doit pas écraser « You3 vx.y.z » dans la barre de la fenêtre.
  win.on('page-title-updated', (e) => e.preventDefault());
  win.once('ready-to-show', () => win?.show());
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Aucune navigation ni ouverture de fenêtre depuis le contenu web.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => (win = null));
}

function openHelp(): void {
  if (helpWin && !helpWin.isDestroyed()) {
    if (helpWin.isMinimized()) helpWin.restore();
    helpWin.focus();
    return;
  }
  helpWin = new BrowserWindow({
    width: 980,
    height: 800,
    title: "You3 : mode d'emploi",
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    backgroundColor: '#14161c',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  helpWin.removeMenu();
  void helpWin.loadFile(path.join(__dirname, '..', 'renderer', 'help.html'));
  const openOut = (url: string) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
  };
  helpWin.webContents.setWindowOpenHandler(({ url }) => {
    openOut(url);
    return { action: 'deny' };
  });
  helpWin.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    openOut(url);
  });
  helpWin.on('closed', () => (helpWin = null));
}

function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Fichier',
        submenu: [
          { label: 'Importer un fichier .txt…', accelerator: 'CmdOrCtrl+O', click: () => void importTxt() },
          { label: 'Ouvrir le dossier Téléchargements', click: () => void shell.openPath(dirs.downloads()) },
          { type: 'separator' },
          { role: 'quit', label: 'Quitter' },
        ],
      },
      {
        label: 'Aide',
        submenu: [
          { label: "Mode d'emploi", accelerator: 'F1', click: () => openHelp() },
          { label: 'Mises à jour…', click: () => send('nav', 'maintenance') },
          { label: 'Ouvrir le dossier des journaux', click: () => void shell.openPath(dirs.logs()) },
          { label: 'Outils de développement', accelerator: 'F12', role: 'toggleDevTools' },
          { type: 'separator' },
          { label: 'À propos de You3', click: () => send('nav', 'about') },
        ],
      },
    ]),
  );
}

/** « Oui » seulement si l'utilisateur le confirme et que le fichier est modifiable. */
async function askRemoveEntries(filePath: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox(win!, {
    type: 'question',
    title: 'Import du fichier',
    message: 'Voulez-vous effacer les entrées du .txt après conversion ?',
    detail: `Chaque lien converti avec succès sera retiré de « ${path.basename(filePath)} ». Les liens en échec restent dans le fichier.`,
    buttons: ['Oui', 'Non'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return false;
  try {
    fs.accessSync(filePath, fs.constants.W_OK);
    return true;
  } catch {
    log('WARN', 'import', `Fichier en lecture seule, les entrées ne seront pas effacées : ${filePath}`);
    await dialog.showMessageBox(win!, {
      type: 'warning',
      title: 'Import du fichier',
      message: 'Ce fichier est en lecture seule.',
      detail: 'Les liens seront convertis, mais les entrées ne pourront pas être effacées du fichier.',
      buttons: ['OK'],
      noLink: true,
    });
    return false;
  }
}

async function importTxt(filePath?: string): Promise<queue.AddResult | null> {
  if (!filePath) {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Importer une liste de liens',
      defaultPath: path.join(app.getPath('desktop'), 'Playlist1.txt'),
      filters: [{ name: 'Fichiers texte', extensions: ['txt'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    filePath = r.filePaths[0];
  }
  if (path.extname(filePath).toLowerCase() !== '.txt') throw new Error('Seuls les fichiers .txt sont acceptés');
  const stat = fs.statSync(filePath);
  if (stat.size > 5 * 1024 * 1024) throw new Error('Fichier trop volumineux (5 Mo maximum)');
  const removeOnSuccess = await askRemoveEntries(filePath);
  log('INFO', 'import', `Import du fichier ${filePath} (effacement des entrées après conversion : ${removeOnSuccess ? 'oui' : 'non'})`);
  const res = queue.addFromText(fs.readFileSync(filePath, 'utf8'), { file: filePath, removeOnSuccess });
  if (removeOnSuccess) res.removeFrom = path.basename(filePath);
  send('import-result', res);
  return res;
}

function registerIpc(): void {
  // File d'attente
  ipcMain.handle('queue:add', (_e, text: string) => queue.addFromText(String(text)));
  ipcMain.handle('queue:importTxt', (_e, filePath?: string) => importTxt(filePath));
  ipcMain.handle('queue:list', () => queue.snapshot());
  ipcMain.handle('queue:requeue', (_e, id: string) => queue.requeue(id));
  ipcMain.handle('queue:remove', (_e, id: string) => queue.remove(id));
  ipcMain.handle('queue:cancelAll', () => queue.cancelAll());
  ipcMain.handle('queue:clearFinished', () => queue.clearFinished());

  // Historique
  ipcMain.handle('history:list', (_e, search: string, status: string) => db.listDownloads(String(search ?? ''), String(status ?? ''), 500));
  ipcMain.handle('history:delete', (_e, id: number) => db.deleteDownload(Number(id)));
  ipcMain.handle('history:clear', () => {
    db.clearDownloads();
    log('INFO', 'history', 'Historique vidé');
  });
  ipcMain.handle('history:stats', () => db.stats());

  // Journal
  ipcMain.handle('logs:list', (_e, level: string, search: string) => db.listLogs(String(level ?? 'ALL'), String(search ?? ''), 1000));
  ipcMain.handle('logs:clear', () => db.clearLogs());
  ipcMain.handle('logs:openFolder', () => shell.openPath(dirs.logs()));
  ipcMain.handle('logs:currentFile', () => currentLogFile());

  // Fichiers / dossiers
  ipcMain.handle('fs:showInFolder', async (_e, p: string) => {
    if (typeof p !== 'string' || !fs.existsSync(p)) return false;
    // Playou3 installé : on l'ouvre (ou on le met au premier plan) sur ce fichier ;
    // sinon on propose de l'installer, et à défaut l'Explorateur Windows.
    const playou3 = path.join(app.getPath('appData'), '..', 'Local', 'Programs', 'Playou3', 'Playou3.exe');
    if (/\.(mp3|wav)$/i.test(p)) {
      if (fs.existsSync(playou3)) {
        try {
          spawn(playou3, ['--show', p], { detached: true, stdio: 'ignore' }).unref();
          return true;
        } catch (e) {
          log('WARN', 'app', `Lancement de Playou3 impossible : ${(e as Error).message}`);
        }
      } else if (!playou3Declined && (await offerPlayou3Install())) {
        return true;
      }
    }
    shell.showItemInFolder(p);
    return true;
  });
  ipcMain.handle('fs:openDownloads', () => shell.openPath(dirs.downloads()));
  ipcMain.handle('fs:exists', (_e, p: string) => typeof p === 'string' && fs.existsSync(p));

  // Paramètres
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const s = saveSettings(patch);
    log('INFO', 'settings', `Paramètres modifiés : ${JSON.stringify(patch)}`);
    return s;
  });

  // Maintenance
  ipcMain.handle('tools:status', () => toolsStatus());
  ipcMain.handle('tools:checkYtdlp', async () => {
    try {
      return { ok: true, ...(await checkYtdlp()) };
    } catch (e) {
      log('WARN', 'tools', `Vérification impossible : ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message };
    }
  });
  ipcMain.handle('tools:updateYtdlp', async () => {
    if (queue.isBusy()) return { ok: false, error: 'Un téléchargement est en cours ; réessayez après.' };
    try {
      return { ok: true, version: await installOrUpdateYtdlp() };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  ipcMain.handle('app:openHelp', () => openHelp());
  ipcMain.handle('update:state', () => getUpdateState());
  ipcMain.handle('update:check', () => checkForUpdate());
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) void shell.openExternal(url);
  });
  ipcMain.handle('app:info', () => ({
    name: 'You3',
    version: app.getVersion(),
    author: 'Vachon Marc-Olivier',
    company: 'Hawkus Corp.',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    dataDir: dataDir(),
    dbFile: dirs.db(),
    logsDir: dirs.logs(),
    downloadsDir: dirs.downloads(),
    ytdlpFile: ytdlpPath(),
  }));
}

/** Notification quand une série de téléchargements est terminée. */
function watchQueueCompletion(): void {
  let wasActive = false;
  queue.setQueueListener((items) => {
    send('queue:update', items);
    const active = items.some((i) => i.status === 'pending' || i.status === 'running');
    if (wasActive && !active) {
      const ok = items.filter((i) => i.status === 'done').length;
      const ko = items.filter((i) => i.status === 'error').length;
      if (Notification.isSupported()) {
        new Notification({
          title: 'You3',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
          body: ko ? `${ok} MP3 enregistré(s), ${ko} en échec.` : `${ok} MP3 enregistré(s) dans Téléchargements.`,
        }).show();
      }
      if (win && !win.isFocused()) win.flashFrame(true);
    }
    wasActive = active;
  });
}

async function start(): Promise<void> {
  db.openDb();
  onLog(() => send('logs:changed'));
  purgeOld();
  log('INFO', 'app', `Démarrage de You3 ${app.getVersion()} (Electron ${process.versions.electron})`);
  const interrupted = db.failInterrupted();
  if (interrupted) log('WARN', 'app', `${interrupted} traitement(s) interrompu(s) lors de la session précédente`);

  registerIpc();
  watchQueueCompletion();
  startBridge();
  buildMenu();
  createWindow();

  process.on('uncaughtException', (e) => log('ERROR', 'app', `Exception non gérée : ${e.stack ?? e.message}`));
  process.on('unhandledRejection', (e) => log('ERROR', 'app', `Promesse rejetée : ${String(e)}`));

  initUpdater((st) => send('update:state', st));
  if (app.isPackaged) void checkForUpdate();

  send('tools:busy', true);
  await ensureYtdlp();
  send('tools:busy', false);
  send('tools:changed');
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  queue.cancelAll();
  log('INFO', 'app', 'Arrêt de You3');
  db.closeDb();
});
