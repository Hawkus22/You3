import { DatabaseSync } from 'node:sqlite';
import { dirs } from './paths';

export type DownloadStatus = 'RUNNING' | 'OK' | 'KO';

export interface DownloadRow {
  id: number;
  url: string;
  video_id: string;
  title: string | null;
  status: DownloadStatus;
  error_message: string | null;
  file_path: string | null;
  bitrate: number;
  started_at: string;
  finished_at: string | null;
}

export interface LogRow {
  id: number;
  ts: string;
  level: string;
  source: string;
  message: string;
  download_id: number | null;
}

let db: DatabaseSync;

export function openDb(): DatabaseSync {
  db = new DatabaseSync(dirs.db());
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL CHECK (status IN ('RUNNING','OK','KO')),
      error_message TEXT,
      file_path TEXT,
      bitrate INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_downloads_video ON downloads(video_id, status);
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      download_id INTEGER REFERENCES downloads(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export const now = (): string => new Date().toISOString();

// ---- Téléchargements ----------------------------------------------------

export function insertDownload(url: string, videoId: string, bitrate: number): number {
  const r = db
    .prepare(`INSERT INTO downloads (url, video_id, status, bitrate, started_at) VALUES (?, ?, 'RUNNING', ?, ?)`)
    .run(url, videoId, bitrate, now());
  return Number(r.lastInsertRowid);
}

export function setDownloadTitle(id: number, title: string): void {
  db.prepare(`UPDATE downloads SET title = ? WHERE id = ?`).run(title, id);
}

export function finishDownload(id: number, status: 'OK' | 'KO', filePath: string | null, error: string | null): void {
  db.prepare(`UPDATE downloads SET status = ?, file_path = ?, error_message = ?, finished_at = ? WHERE id = ?`).run(
    status,
    filePath,
    error,
    now(),
    id,
  );
}

/** Dernier téléchargement réussi pour cette vidéo (détection de doublon). */
export function findPreviousOk(videoId: string): DownloadRow | undefined {
  return db
    .prepare(`SELECT * FROM downloads WHERE video_id = ? AND status = 'OK' ORDER BY id DESC LIMIT 1`)
    .get(videoId) as unknown as DownloadRow | undefined;
}

export function listDownloads(search: string, status: string, limit: number): DownloadRow[] {
  const where: string[] = [`status != 'RUNNING'`];
  const args: (string | number)[] = [];
  if (status === 'OK' || status === 'KO') {
    where.push('status = ?');
    args.push(status);
  }
  if (search) {
    where.push(`(title LIKE ? OR url LIKE ? OR video_id LIKE ?)`);
    const s = `%${search}%`;
    args.push(s, s, s);
  }
  args.push(limit);
  return db
    .prepare(`SELECT * FROM downloads WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`)
    .all(...args) as unknown as DownloadRow[];
}

export function deleteDownload(id: number): void {
  db.prepare(`DELETE FROM downloads WHERE id = ?`).run(id);
}

export function clearDownloads(): void {
  db.prepare(`DELETE FROM downloads WHERE status != 'RUNNING'`).run();
}

/** Au démarrage : les téléchargements restés RUNNING ont été interrompus. */
export function failInterrupted(): number {
  const r = db
    .prepare(
      `UPDATE downloads SET status = 'KO', error_message = 'Interrompu (application fermée pendant le traitement)', finished_at = ? WHERE status = 'RUNNING'`,
    )
    .run(now());
  return Number(r.changes);
}

export function stats(): { ok: number; ko: number } {
  const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM downloads GROUP BY status`).all() as unknown as {
    status: string;
    n: number;
  }[];
  const get = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  return { ok: get('OK'), ko: get('KO') };
}

// ---- Journal -------------------------------------------------------------

export function insertLog(level: string, source: string, message: string, downloadId: number | null): void {
  db.prepare(`INSERT INTO logs (ts, level, source, message, download_id) VALUES (?, ?, ?, ?, ?)`).run(
    now(),
    level,
    source,
    message,
    downloadId,
  );
}

export function listLogs(level: string, search: string, limit: number): LogRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (level && level !== 'ALL') {
    where.push('level = ?');
    args.push(level);
  }
  if (search) {
    where.push('(message LIKE ? OR source LIKE ?)');
    args.push(`%${search}%`, `%${search}%`);
  }
  args.push(limit);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM logs ${w} ORDER BY id DESC LIMIT ?`).all(...args) as unknown as LogRow[];
}

export function clearLogs(): void {
  db.exec(`DELETE FROM logs`);
}

export function purgeOldLogs(days: number): void {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  db.prepare(`DELETE FROM logs WHERE ts < ?`).run(cutoff);
}

// ---- Paramètres ----------------------------------------------------------

export function getSetting(key: string): string | undefined {
  const r = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as unknown as { value: string } | undefined;
  return r?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    key,
    value,
  );
}

export function closeDb(): void {
  try {
    db?.close();
  } catch {
    /* déjà fermée */
  }
}
