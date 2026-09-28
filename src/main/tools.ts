import { net } from 'electron';
import fs from 'fs';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { ffmpegPath, ytdlpPath } from './paths';
import { log } from './logger';
import { getSettings } from './settings';

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const YTDLP_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

export interface ToolsStatus {
  ytdlpInstalled: boolean;
  ytdlpVersion: string | null;
  ffmpegOk: boolean;
  ffmpegVersion: string | null;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`code ${code}`))));
  });
}

export async function toolsStatus(): Promise<ToolsStatus> {
  let ytdlpVersion: string | null = null;
  let ffmpegVersion: string | null = null;
  if (fs.existsSync(ytdlpPath())) {
    try {
      ytdlpVersion = await run(ytdlpPath(), ['--version']);
    } catch (e) {
      log('ERROR', 'tools', `yt-dlp inutilisable : ${(e as Error).message}`);
    }
  }
  try {
    ffmpegVersion = (await run(ffmpegPath(), ['-version'])).split('\n')[0].trim().replace(/^ffmpeg version\s+/, '');
  } catch (e) {
    log('ERROR', 'tools', `ffmpeg inutilisable : ${(e as Error).message}`);
  }
  return { ytdlpInstalled: !!ytdlpVersion, ytdlpVersion, ffmpegOk: !!ffmpegVersion, ffmpegVersion };
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(dest));
}

/** Télécharge (ou remplace) yt-dlp.exe depuis la dernière release officielle. */
export async function installOrUpdateYtdlp(): Promise<string> {
  const target = ytdlpPath();
  const tmp = `${target}.new`;
  log('INFO', 'tools', 'Téléchargement de yt-dlp...');
  try {
    await downloadTo(YTDLP_URL, tmp);
    const version = await run(tmp, ['--version']); // vérifie que le binaire s'exécute
    fs.renameSync(tmp, target);
    log('INFO', 'tools', `yt-dlp installé : version ${version}`);
    return version;
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    log('ERROR', 'tools', `Échec de la mise à jour de yt-dlp : ${(e as Error).message}`);
    throw e;
  }
}

export async function latestYtdlpVersion(): Promise<string> {
  const res = await net.fetch(YTDLP_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { tag_name: string };
  return json.tag_name;
}

export interface YtdlpCheck {
  current: string | null;
  latest: string;
  upToDate: boolean;
}

export async function checkYtdlp(): Promise<YtdlpCheck> {
  const [{ ytdlpVersion }, latest] = await Promise.all([toolsStatus(), latestYtdlpVersion()]);
  return { current: ytdlpVersion, latest, upToDate: ytdlpVersion === latest };
}

/** Au lancement : installe yt-dlp s'il manque, sinon le met à jour si l'option est active. */
export async function ensureYtdlp(): Promise<void> {
  try {
    if (!fs.existsSync(ytdlpPath())) {
      await installOrUpdateYtdlp();
    } else if (getSettings().autoUpdateYtdlp) {
      const c = await checkYtdlp();
      if (!c.upToDate) {
        log('INFO', 'tools', `Nouvelle version de yt-dlp : ${c.current} -> ${c.latest}`);
        await installOrUpdateYtdlp();
      }
    }
  } catch (e) {
    log('WARN', 'tools', `Vérification de yt-dlp impossible : ${(e as Error).message}`);
  }
}
