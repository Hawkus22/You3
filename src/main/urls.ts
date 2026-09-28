export interface ParsedUrl {
  url: string;
  videoId: string;
}
export interface InvalidEntry {
  text: string;
  reason: string;
}

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseOne(raw: string): ParsedUrl | InvalidEntry {
  const text = raw.trim();
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { text, reason: 'Lien invalide' };
  }
  const host = u.hostname.toLowerCase();
  if (!YT_HOSTS.has(host)) return { text, reason: "Ce n'est pas un lien YouTube" };

  let id: string | null = null;
  if (host.endsWith('youtu.be')) {
    id = u.pathname.split('/')[1] ?? null;
  } else if (u.pathname === '/watch') {
    id = u.searchParams.get('v');
  } else {
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?]+)/);
    id = m ? m[1] : null;
  }
  if (id && ID_RE.test(id)) return { url: `https://www.youtube.com/watch?v=${id}`, videoId: id };
  if (u.searchParams.has('list') || u.pathname === '/playlist') {
    return { text, reason: 'Les playlists ne sont pas prises en charge dans cette version' };
  }
  return { text, reason: 'Identifiant de vidéo introuvable' };
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
