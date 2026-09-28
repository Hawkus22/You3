import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { dirs, ffmpegPath, ytdlpPath } from './paths';
import { finishDownload, findPreviousOk, insertDownload, setDownloadTitle } from './db';
import { log } from './logger';
import { getSettings } from './settings';
import { InvalidEntry, parseText } from './urls';

export type ItemStatus = 'pending' | 'duplicate' | 'running' | 'done' | 'error';

export interface QueueItem {
  id: string;
  url: string;
  videoId: string;
  title: string | null;
  status: ItemStatus;
  percent: number;
  phase: string;
  speed: string;
  message: string | null;
  filePath: string | null;
  previous: { date: string; filePath: string | null; fileExists: boolean } | null;
}

export interface AddResult {
  added: number;
  alreadyDownloaded: number;
  alreadyInQueue: number;
  invalid: InvalidEntry[];
}

const items: QueueItem[] = [];
let current: { item: QueueItem; proc: ChildProcess | null; cancelled: boolean } | null = null;
let onChange: (items: QueueItem[]) => void = () => undefined;
let timer: NodeJS.Timeout | null = null;
let pumping = false;

export function setQueueListener(cb: (items: QueueItem[]) => void): void {
  onChange = cb;
}

export function snapshot(): QueueItem[] {
  return items.map((i) => ({ ...i }));
}

/** Diffusion limitée à ~10/s pour ne pas saturer l'UI pendant la progression. */
function emit(immediate = false): void {
  if (immediate) {
    if (timer) clearTimeout(timer);
    timer = null;
    onChange(snapshot());
    return;
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    onChange(snapshot());
  }, 100);
}

export function isBusy(): boolean {
  return current !== null;
}

export function addFromText(text: string): AddResult {
  const parsed = parseText(text);
  const result: AddResult = { added: 0, alreadyDownloaded: 0, alreadyInQueue: 0, invalid: parsed.invalid };
  result.alreadyInQueue += parsed.duplicates;

  for (const p of parsed.valid) {
    if (items.some((i) => i.videoId === p.videoId && (i.status === 'pending' || i.status === 'running' || i.status === 'duplicate'))) {
      result.alreadyInQueue++;
      continue;
    }
    const prev = findPreviousOk(p.videoId);
    const item: QueueItem = {
      id: randomUUID(),
      url: p.url,
      videoId: p.videoId,
      title: prev?.title ?? null,
      status: prev ? 'duplicate' : 'pending',
      percent: 0,
      phase: '',
      speed: '',
      message: null,
      filePath: null,
      previous: prev
        ? {
            date: prev.finished_at ?? prev.started_at,
            filePath: prev.file_path,
            fileExists: !!prev.file_path && fs.existsSync(prev.file_path),
          }
        : null,
    };
    if (prev) {
      result.alreadyDownloaded++;
      log('INFO', 'queue', `Lien déjà téléchargé le ${item.previous?.date} : ${p.url}`);
    } else {
      result.added++;
      log('INFO', 'queue', `Ajouté à la file : ${p.url}`);
    }
    items.push(item);
  }
  for (const inv of result.invalid) log('WARN', 'queue', `Entrée ignorée « ${inv.text} » : ${inv.reason}`);
  emit(true);
  void pump();
  return result;
}

/** Relance un élément en erreur, ou confirme le re-téléchargement d'un doublon. */
export function requeue(id: string): void {
  const it = items.find((i) => i.id === id);
  if (!it || (it.status !== 'duplicate' && it.status !== 'error')) return;
  it.status = 'pending';
  it.percent = 0;
  it.message = null;
  it.phase = '';
  emit(true);
  void pump();
}

export function remove(id: string): void {
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return;
  if (items[idx].status === 'running') {
    cancel(id);
    return;
  }
  items.splice(idx, 1);
  emit(true);
}

export function clearFinished(): void {
  for (let i = items.length - 1; i >= 0; i--) {
    if (['done', 'error', 'duplicate'].includes(items[i].status)) items.splice(i, 1);
  }
  emit(true);
}

export function cancel(id: string): void {
  if (!current || current.item.id !== id) return;
  current.cancelled = true;
  killTree(current.proc);
}

export function cancelAll(): void {
  for (const i of items) {
    if (i.status !== 'pending') continue;
    i.status = 'error';
    i.message = 'Annulé';
  }
  if (current) cancel(current.item.id);
  emit(true);
}

function killTree(proc: ChildProcess | null): void {
  if (!proc?.pid) return;
  // yt-dlp.exe (PyInstaller) crée un processus fils : on tue l'arbre entier.
  spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = items.find((i) => i.status === 'pending');
      if (!next) break;
      await process1(next);
    }
  } finally {
    pumping = false;
  }
}

const FRIENDLY: [RegExp, string][] = [
  [/Private video/i, 'Vidéo privée'],
  [/video is unavailable|Video unavailable|has been removed|no longer available/i, 'Vidéo indisponible ou supprimée'],
  [/Sign in to confirm your age|age-restricted/i, "Vidéo soumise à une restriction d'âge (connexion requise)"],
  [/not available in your country|blocked it in your country|geo/i, 'Vidéo bloquée dans votre pays'],
  [/confirm you.re not a bot/i, 'YouTube demande une vérification anti-robot ; réessayez plus tard'],
  [/Unable to download webpage|getaddrinfo|Temporary failure|timed out|Connection|Errno 11001/i, 'Problème de connexion réseau'],
  [/members-only|Join this channel/i, 'Vidéo réservée aux membres de la chaîne'],
  [/live event will begin|is live|premieres in/i, "Diffusion en direct ou première pas encore terminée"],
  [/Requested format is not available|nsig|Signature/i, 'Extraction impossible : mettez à jour yt-dlp (onglet Maintenance)'],
];

function friendlyError(raw: string): string {
  const hit = FRIENDLY.find(([re]) => re.test(raw));
  return hit ? `${hit[1]} — ${raw}` : raw;
}

function uniqueTarget(dir: string, fileName: string): string {
  const { name, ext } = path.parse(fileName);
  let candidate = path.join(dir, fileName);
  for (let n = 1; fs.existsSync(candidate); n++) candidate = path.join(dir, `${name} (${n})${ext}`);
  return candidate;
}

function moveFile(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    fs.copyFileSync(src, dest);
    fs.rmSync(src, { force: true });
  }
}

async function process1(item: QueueItem): Promise<void> {
  const { bitrate } = getSettings();
  const downloadId = insertDownload(item.url, item.videoId, bitrate);
  const work = path.join(dirs.tmp(), `${item.videoId}-${downloadId}`);
  fs.mkdirSync(work, { recursive: true });

  current = { item, proc: null, cancelled: false };
  item.status = 'running';
  item.percent = 0;
  item.phase = 'Analyse du lien';
  item.message = null;
  emit(true);
  log('INFO', 'convert', `Début (${bitrate} kbps) : ${item.url}`, downloadId);

  if (!fs.existsSync(ytdlpPath())) {
    fail(item, downloadId, 'yt-dlp est absent : ouvrez l\'onglet Maintenance pour l\'installer');
    fs.rmSync(work, { recursive: true, force: true });
    current = null;
    return;
  }

  const args = [
    '--js-runtimes', `node:${process.execPath}`,
    '--remote-components', 'ejs:github',
    '-x', '--audio-format', 'mp3', '--audio-quality', `${bitrate}K`,
    '--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg',
    '--no-playlist', '--no-mtime', '--windows-filenames', '--trim-filenames', '150',
    '--ffmpeg-location', ffmpegPath(),
    '--newline', '--progress', '--no-simulate',
    '--print', 'before_dl:TITLE|%(title)s',
    '--progress-template', 'download:PROG|%(progress._percent_str)s|%(progress._speed_str)s',
    '-P', work, '-o', '%(title)s.%(ext)s',
    item.url,
  ];

  const errors: string[] = [];
  let lastLines: string[] = [];

  const exitCode = await new Promise<number>((resolve) => {
    const proc = spawn(ytdlpPath(), args, {
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    current!.proc = proc;

    const handle = (line: string) => {
      line = line.trim();
      if (!line) return;
      if (line.startsWith('TITLE|')) {
        item.title = line.slice(6);
        setDownloadTitle(downloadId, item.title);
        item.phase = 'Téléchargement';
      } else if (line.startsWith('PROG|')) {
        const [, pct, speed] = line.split('|');
        const p = parseFloat(pct);
        if (!Number.isNaN(p)) {
          item.percent = p;
          item.phase = p >= 100 ? 'Conversion en MP3' : 'Téléchargement';
        }
        item.speed = (speed ?? '').trim();
      } else {
        if (/^ERROR:/i.test(line)) errors.push(line.replace(/^ERROR:\s*/i, ''));
        lastLines.push(line);
        if (lastLines.length > 30) lastLines = lastLines.slice(-30);
        log(/^ERROR:/i.test(line) ? 'ERROR' : /^WARNING:/i.test(line) ? 'WARN' : 'DEBUG', 'yt-dlp', line, downloadId);
      }
      emit();
    };

    for (const stream of [proc.stdout, proc.stderr]) {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        buf += chunk;
        const parts = buf.split(/\r?\n|\r/);
        buf = parts.pop() ?? '';
        parts.forEach(handle);
      });
      stream.on('end', () => buf && handle(buf));
    }
    proc.on('error', (e) => {
      errors.push(`Impossible de lancer yt-dlp : ${e.message}`);
      resolve(-1);
    });
    proc.on('close', (code) => resolve(code ?? -1));
  });

  const wasCancelled = current?.cancelled ?? false;
  try {
    if (wasCancelled) {
      fail(item, downloadId, "Annulé par l'utilisateur");
    } else if (exitCode !== 0) {
      const raw = errors.length ? errors.join(' | ') : lastLines.slice(-3).join(' | ') || `yt-dlp a échoué (code ${exitCode})`;
      fail(item, downloadId, friendlyError(raw));
    } else {
      const mp3 = fs.readdirSync(work).find((f) => f.toLowerCase().endsWith('.mp3'));
      if (!mp3) {
        fail(item, downloadId, 'Conversion terminée mais aucun fichier MP3 produit');
      } else {
        const dest = uniqueTarget(dirs.downloads(), mp3);
        moveFile(path.join(work, mp3), dest);
        item.status = 'done';
        item.percent = 100;
        item.phase = 'Terminé';
        item.filePath = dest;
        item.speed = '';
        finishDownload(downloadId, 'OK', dest, null);
        log('INFO', 'convert', `OK : ${dest}`, downloadId);
      }
    }
  } catch (e) {
    fail(item, downloadId, `Erreur lors de l'enregistrement du fichier : ${(e as Error).message}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    current = null;
    emit(true);
  }
}

function fail(item: QueueItem, downloadId: number, message: string): void {
  item.status = 'error';
  item.phase = 'Échec';
  item.message = message;
  item.speed = '';
  finishDownload(downloadId, 'KO', null, message);
  log('ERROR', 'convert', `KO : ${message}`, downloadId);
}
