import fs from 'fs';
import path from 'path';
import { dirs } from './paths';
import { insertLog, purgeOldLogs } from './db';

export type Level = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const RETENTION_DAYS = 30;
let listener: (() => void) | null = null;

/** Notifie l'UI qu'une entrée de journal a été ajoutée. */
export function onLog(cb: () => void): void {
  listener = cb;
}

export function currentLogFile(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(dirs.logs(), `you3-${day}.log`);
}

export function log(level: Level, source: string, message: string, downloadId: number | null = null): void {
  const line = `${new Date().toISOString()} [${level}] [${source}]${downloadId ? ` #${downloadId}` : ''} ${message}\n`;
  try {
    fs.appendFileSync(currentLogFile(), line);
  } catch {
    /* ne jamais planter à cause du log */
  }
  try {
    insertLog(level, source, message, downloadId);
  } catch {
    /* idem */
  }
  listener?.();
}

/** Supprime les anciens fichiers .log et les lignes de journal en base. */
export function purgeOld(): void {
  const cutoff = Date.now() - RETENTION_DAYS * 86400_000;
  try {
    for (const f of fs.readdirSync(dirs.logs())) {
      const full = path.join(dirs.logs(), f);
      if (f.endsWith('.log') && fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
    }
    purgeOldLogs(RETENTION_DAYS);
  } catch {
    /* non bloquant */
  }
}
