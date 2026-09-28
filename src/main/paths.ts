import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export function ensure(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dataDir(): string {
  return app.getPath('userData');
}

export const dirs = {
  bin: () => ensure(path.join(dataDir(), 'bin')),
  logs: () => ensure(path.join(dataDir(), 'logs')),
  tmp: () => ensure(path.join(dataDir(), 'tmp')),
  db: () => path.join(dataDir(), 'you3.db'),
  downloads: () => app.getPath('downloads'),
};

export function ytdlpPath(): string {
  return path.join(dirs.bin(), 'yt-dlp.exe');
}

export function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const p: string = require('ffmpeg-static');
  return p.replace('app.asar', 'app.asar.unpacked');
}
