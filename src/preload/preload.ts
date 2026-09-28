import { contextBridge, ipcRenderer, webUtils } from 'electron';
// eslint-disable-next-line @typescript-eslint/no-explicit-any

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const on = (channel: string, cb: (...args: any[]) => void) => {
  const handler = (_e: unknown, ...args: any[]) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('you3', {
  pathForFile: (f: File) => webUtils.getPathForFile(f),

  queue: {
    add: (text: string) => invoke('queue:add', text),
    importTxt: (filePath?: string) => invoke('queue:importTxt', filePath),
    list: () => invoke('queue:list'),
    requeue: (id: string) => invoke('queue:requeue', id),
    remove: (id: string) => invoke('queue:remove', id),
    cancelAll: () => invoke('queue:cancelAll'),
    clearFinished: () => invoke('queue:clearFinished'),
  },
  history: {
    list: (search: string, status: string) => invoke('history:list', search, status),
    delete: (id: number) => invoke('history:delete', id),
    clear: () => invoke('history:clear'),
    stats: () => invoke('history:stats'),
  },
  logs: {
    list: (level: string, search: string) => invoke('logs:list', level, search),
    clear: () => invoke('logs:clear'),
    openFolder: () => invoke('logs:openFolder'),
    currentFile: () => invoke('logs:currentFile'),
  },
  fs: {
    showInFolder: (p: string) => invoke('fs:showInFolder', p),
    openDownloads: () => invoke('fs:openDownloads'),
    exists: (p: string) => invoke('fs:exists', p),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch: object) => invoke('settings:set', patch),
  },
  tools: {
    status: () => invoke('tools:status'),
    checkYtdlp: () => invoke('tools:checkYtdlp'),
    updateYtdlp: () => invoke('tools:updateYtdlp'),
  },
  app: {
    info: () => invoke('app:info'),
    checkUpdate: () => invoke('app:checkUpdate'),
    openExternal: (url: string) => invoke('app:openExternal', url),
  },

  onQueue: (cb: (items: unknown[]) => void) => on('queue:update', cb),
  onLogsChanged: (cb: () => void) => on('logs:changed', cb),
  onNav: (cb: (tab: string) => void) => on('nav', cb),
  onImportResult: (cb: (r: unknown) => void) => on('import-result', cb),
  onToolsBusy: (cb: (busy: boolean) => void) => on('tools:busy', cb),
  onToolsChanged: (cb: () => void) => on('tools:changed', cb),
});
