import { app } from 'electron';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { findPreviousOk } from './db';
import { log } from './logger';
import { addFromText, AddResult } from './queue';
import { parseText } from './urls';

/** Port local fixe, utilisé par l'extension navigateur (voir extension/background.js). Différent de You4 (47804). */
export const BRIDGE_PORT = 47803;
const TXT_NAME = 'You3_A_telecharger.txt';

export function toDownloadTxt(): string {
  return path.join(app.getPath('documents'), TXT_NAME);
}

/** Ajoute le lien à la fin du .txt, sur sa propre ligne ; retourne false s'il y est déjà. */
function appendLink(file: string, url: string, videoId: string): boolean {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (parseText(raw).valid.some((p) => p.videoId === videoId)) return false;
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const sep = raw && !/\r?\n$/.test(raw) ? eol : '';
  fs.writeFileSync(file, `${raw}${sep}${url}${eol}`);
  return true;
}

/** Dossiers analysés par Playou3 (lecture seule de son fichier de données) ; vide si Playou3 n'est pas installé. */
function playou3Folders(): string[] {
  try {
    const dir = path.join(app.getPath('appData'), 'Playou3');
    let store = path.join(dir, 'store.json');
    const cfg = path.join(dir, 'config.json');
    if (fs.existsSync(cfg)) store = (JSON.parse(fs.readFileSync(cfg, 'utf8')) as { storePath?: string }).storePath || store;
    const folders = (JSON.parse(fs.readFileSync(store, 'utf8')) as { folders?: string[] }).folders;
    return Array.isArray(folders) ? folders : [];
  } catch {
    return [];
  }
}

/** Cherche un fichier par son nom dans les dossiers (sous-dossiers inclus) ; null si introuvable. */
function findByName(dirs: string[], fileName: string): string | null {
  const wanted = fileName.toLowerCase();
  const stack = [...dirs];
  while (stack.length) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && !e.name.startsWith('$')) stack.push(p);
      } else if (e.name.toLowerCase() === wanted) return p;
    }
  }
  return null;
}

export interface CheckResult {
  found: boolean;
  where?: 'you3' | 'playou3';
  title?: string | null;
  path?: string;
}

/**
 * Ce son a-t-il déjà été téléchargé par You3 ? Si le fichier a été déplacé depuis,
 * on le cherche par son nom dans les dossiers de Playou3.
 */
function handleCheck(url: string): CheckResult {
  const [p] = parseText(url).valid;
  if (!p) return { found: false };
  const prev = findPreviousOk(p.videoId);
  if (!prev?.file_path) return { found: false };
  if (fs.existsSync(prev.file_path)) return { found: true, where: 'you3', title: prev.title, path: prev.file_path };
  const moved = findByName(playou3Folders(), path.basename(prev.file_path));
  if (moved) return { found: true, where: 'playou3', title: prev.title, path: moved };
  return { found: false };
}

function handleAdd(url: string): { ok: boolean; message: string } {
  const parsed = parseText(url);
  if (!parsed.valid.length) {
    return { ok: false, message: parsed.invalid[0]?.reason ?? 'Lien non reconnu' };
  }
  const file = toDownloadTxt();
  const [p] = parsed.valid;
  const added = appendLink(file, p.url, p.videoId);
  // Mis en file avec retrait du lien du .txt après téléchargement réussi (même logique que l'import).
  const res: AddResult = addFromText(p.url, { file, removeOnSuccess: true });
  log('INFO', 'bridge', `Lien reçu de l'extension : ${p.url}${added ? '' : ' (déjà dans le .txt)'}`);
  if (res.alreadyDownloaded) return { ok: true, message: 'Déjà téléchargé' };
  if (res.alreadyInQueue) return { ok: true, message: 'Déjà dans la file' };
  return { ok: true, message: 'Ajouté' };
}

/** Serveur HTTP local (127.0.0.1 uniquement), réservé aux extensions du navigateur (Firefox et Chrome). */
export function startBridge(): void {
  const server = http.createServer((req, res) => {
    // Seule une extension navigateur peut appeler : une page web (http/https) est refusée.
    const origin = req.headers.origin ?? '';
    const fromExtension = origin.startsWith('moz-extension://') || origin.startsWith('chrome-extension://');
    const send = (code: number, body: object) => {
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        ...(fromExtension ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type' } : {}),
      });
      res.end(JSON.stringify(body));
    };
    if (!fromExtension) return send(403, { ok: false, message: 'Refusé' });
    if (req.method === 'OPTIONS') return send(204, {});
    if (req.method !== 'POST' || (req.url !== '/add' && req.url !== '/check')) return send(404, { ok: false, message: 'Introuvable' });
    const route = req.url;

    let data = '';
    req.on('data', (c: Buffer) => {
      data += c;
      if (data.length > 10_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const { url } = JSON.parse(data) as { url?: unknown };
        if (typeof url !== 'string') return send(400, { ok: false, message: 'Requête invalide' });
        send(200, route === '/check' ? handleCheck(url) : handleAdd(url));
      } catch (e) {
        log('WARN', 'bridge', `Requête extension invalide : ${(e as Error).message}`);
        send(400, { ok: false, message: 'Requête invalide' });
      }
    });
  });
  server.on('error', (e) => log('WARN', 'bridge', `Serveur local indisponible : ${e.message}`));
  server.listen(BRIDGE_PORT, '127.0.0.1');
}
