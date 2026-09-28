export type Site = 'youtube' | 'facebook' | 'tiktok';

export interface ParsedUrl {
  url: string;
  /**
   * Clé unique de la vidéo (détection des doublons, dossier temporaire, historique).
   * YouTube : l'identifiant seul (compatible avec l'historique existant).
   * Autres sites : préfixe du site, ex. « tiktok-7688834577418194206 », « facebook-10153231379946729 ».
   */
  videoId: string;
  site: Site;
}
export interface InvalidEntry {
  text: string;
  reason: string;
}

const YT_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const FB_HOSTS = new Set(['facebook.com', 'm.facebook.com', 'web.facebook.com', 'mbasic.facebook.com', 'fb.watch']);
const TT_HOSTS = new Set(['tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const CODE = /^[A-Za-z0-9_-]{3,64}$/; // codes des liens courts et de partage
const DIGITS = /^\d{6,25}$/;

const UNSUPPORTED = 'Site non pris en charge (YouTube, Facebook et TikTok uniquement)';
const bad = (text: string, reason: string): InvalidEntry => ({ text, reason });

function parseYoutube(text: string, u: URL, host: string): ParsedUrl | InvalidEntry {
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1] ?? null;
  } else if (u.pathname === '/watch') {
    id = u.searchParams.get('v');
  } else {
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?]+)/);
    id = m ? m[1] : null;
  }
  if (id && YT_ID.test(id)) return { url: `https://www.youtube.com/watch?v=${id}`, videoId: id, site: 'youtube' };
  if (u.searchParams.has('list') || u.pathname === '/playlist') {
    return bad(text, 'Les playlists ne sont pas prises en charge dans cette version');
  }
  return bad(text, 'Identifiant de vidéo introuvable');
}

function parseFacebook(text: string, u: URL, host: string): ParsedUrl | InvalidEntry {
  const fb = (videoId: string, url: string): ParsedUrl => ({ url, videoId, site: 'facebook' });

  if (host === 'fb.watch') {
    const code = u.pathname.split('/')[1] ?? '';
    return CODE.test(code) ? fb(`facebook-w-${code}`, `https://fb.watch/${code}/`) : bad(text, 'Lien Facebook non reconnu');
  }

  const path = u.pathname.replace(/\/+$/, '');
  const v = u.searchParams.get('v');
  if ((path === '/watch' || path === '/video.php') && v && DIGITS.test(v)) {
    return fb(`facebook-${v}`, `https://www.facebook.com/watch/?v=${v}`);
  }
  const videos = path.match(/^(\/[^?]*\/videos\/)(?:[^/]+\/)?(\d{6,25})$/); // /page/videos/ID ou /page/videos/titre/ID
  if (videos) return fb(`facebook-${videos[2]}`, `https://www.facebook.com/watch/?v=${videos[2]}`);
  const reel = path.match(/^\/reel\/(\d{6,25})$/);
  if (reel) return fb(`facebook-${reel[1]}`, `https://www.facebook.com/reel/${reel[1]}`);
  const share = path.match(/^\/share\/([vrp])\/([A-Za-z0-9_-]{3,64})$/);
  if (share) return fb(`facebook-s-${share[2]}`, `https://www.facebook.com/share/${share[1]}/${share[2]}/`);

  return bad(text, 'Lien Facebook non reconnu : collez le lien d\'une vidéo ou d\'un reel précis');
}

function parseTikTok(text: string, u: URL, host: string): ParsedUrl | InvalidEntry {
  const tt = (videoId: string, url: string): ParsedUrl => ({ url, videoId, site: 'tiktok' });
  const path = u.pathname.replace(/\/+$/, '');

  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
    const code = path.split('/')[1] ?? '';
    return CODE.test(code) ? tt(`tiktok-s-${code}`, `https://${host}/${code}/`) : bad(text, 'Lien TikTok non reconnu');
  }
  const video = path.match(/^\/@([^/]+)\/video\/(\d{6,25})$/);
  if (video) return tt(`tiktok-${video[2]}`, `https://www.tiktok.com/@${video[1]}/video/${video[2]}`);
  const short = path.match(/^\/t\/([A-Za-z0-9_-]{3,64})$/);
  if (short) return tt(`tiktok-s-${short[1]}`, `https://www.tiktok.com/t/${short[1]}/`);
  if (/^\/@[^/]+$/.test(path)) return bad(text, "Lien de profil TikTok : collez le lien d'une vidéo précise");
  return bad(text, "Lien TikTok non reconnu : collez le lien d'une vidéo précise");
}

export function parseOne(raw: string): ParsedUrl | InvalidEntry {
  const text = raw.trim();
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return bad(text, 'Lien invalide');
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (YT_HOSTS.has(host)) return parseYoutube(text, u, host);
  if (FB_HOSTS.has(host)) return parseFacebook(text, u, host);
  if (TT_HOSTS.has(host)) return parseTikTok(text, u, host);
  return bad(text, UNSUPPORTED);
}

/** Extrait les liens d'un texte libre ou d'un fichier .txt (un par ligne, # = commentaire). */
export function parseText(input: string): { valid: ParsedUrl[]; invalid: InvalidEntry[]; duplicates: number } {
  const valid: ParsedUrl[] = [];
  const invalid: InvalidEntry[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const line of input.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    for (const token of t.split(/[\s,;]+/).filter(Boolean)) {
      const r = parseOne(token);
      if ('videoId' in r) {
        if (seen.has(r.videoId)) duplicates++;
        else {
          seen.add(r.videoId);
          valid.push(r);
        }
      } else invalid.push(r);
    }
  }
  return { valid, invalid, duplicates };
}
