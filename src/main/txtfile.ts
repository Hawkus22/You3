import fs from 'fs';
import { parseOne } from './urls';

/**
 * Retire d'un fichier .txt de liens toutes les entrées qui désignent cette vidéo
 * (quelle que soit la forme du lien : watch?v=, youtu.be, shorts...).
 * - une ligne qui ne contenait que ce lien est supprimée ;
 * - si une ligne contient plusieurs liens, seul le lien concerné est retiré ;
 * - les lignes vides et les commentaires (#) ne sont pas touchés ;
 * - les fins de ligne (CRLF/LF) et le BOM sont conservés.
 * Retourne le nombre de liens retirés (0 = fichier non modifié).
 */
export function removeVideoFromTxt(file: string, videoId: string): number {
  const raw = fs.readFileSync(file, 'utf8');
  const bom = raw.charCodeAt(0) === 0xfeff ? '﻿' : '';
  const text = bom ? raw.slice(1) : raw;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  let removed = 0;
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      out.push(line);
      continue;
    }
    const tokens = trimmed.split(/[\s,;]+/).filter(Boolean);
    const kept = tokens.filter((t) => {
      const r = parseOne(t);
      return !('videoId' in r && r.videoId === videoId);
    });
    if (kept.length === tokens.length) {
      out.push(line); // rien à retirer sur cette ligne
      continue;
    }
    removed += tokens.length - kept.length;
    if (kept.length > 0) out.push(kept.join(' '));
    // sinon : la ligne ne contenait que ce lien, on la supprime
  }

  if (removed > 0) fs.writeFileSync(file, bom + out.join(eol));
  return removed;
}
