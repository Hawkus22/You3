# You3

Application desktop Windows (Electron + TypeScript) — Hawkus Corp. (auteur : Vachon Marc-Olivier)
Colle un lien YouTube, Facebook ou TikTok (ou importe un `.txt`, un lien par ligne) : l'audio est récupéré avec **yt-dlp**, converti en MP3 par **ffmpeg** (320 kbps par défaut) et enregistré dans le dossier Téléchargements de Windows.

**Mode d'emploi complet (avec captures d'écran) : [docs/MODE-EMPLOI.md](docs/MODE-EMPLOI.md)**, également intégré à l'application (menu Aide → Mode d'emploi, touche F1).

## Lancer

```
npm install
npm run start      # compile puis lance l'application
npm run dist       # installeur Windows -> release/You3-Setup-x.y.z.exe
npm run icon       # régénère assets/icon.png depuis le SVG de scripts/make-icon.js
npm run release    # publie la version de package.json sur GitHub Releases
```

Node 22+ requis (la base SQLite utilise le module intégré `node:sqlite`, aucune compilation native).

## Architecture

| Fichier | Rôle |
|---|---|
| `src/main/main.ts` | fenêtre, menu, IPC, notifications |
| `src/main/queue.ts` | file d'attente séquentielle, pilotage de yt-dlp, détection de doublons |
| `src/main/db.ts` | SQLite : `downloads` (historique, OK/KO, message d'erreur), `logs`, `settings` |
| `src/main/logger.ts` | journal double : base + fichier `logs/you3-AAAA-MM-JJ.log` (rétention 30 j) |
| `src/main/tools.ts` | installation / mise à jour de yt-dlp, vérification de version de You3 |
| `src/main/urls.ts` | extraction et normalisation des liens YouTube |
| `src/preload/preload.ts` | API exposée à l'interface (`window.you3`) |
| `src/renderer/` | interface (HTML/CSS/JS, sans framework) |
| `docs/MODE-EMPLOI.md`, `docs/img/` | mode d'emploi et captures ; `scripts/generate-help.js` en tire la page d'aide de l'application à chaque build |

Données utilisateur : `%APPDATA%\You3\` (`you3.db`, `logs\`, `bin\yt-dlp.exe`).

## Maintenance

- **yt-dlp** : téléchargé au premier lancement, vérifié à chaque démarrage (option désactivable), bouton de mise à jour dans l'onglet Maintenance.
- **You3** : mise à jour automatique via GitHub Releases (`electron-updater`). Au lancement, l'application installée cherche une nouvelle version, la télécharge en arrière-plan, puis propose « Redémarrer et installer » (bouton en haut ou onglet Maintenance).
- Un traitement interrompu (fermeture, crash) est marqué KO au redémarrage suivant.

## Publier une nouvelle version

```
git add -A && git commit -m "..." && git push
npm version patch          # 0.1.0 -> 0.1.1 (crée aussi le tag git ; utiliser minor/major au besoin)
git push --follow-tags
npm run release            # construit l'installeur et crée la Release GitHub
```

Les installations existantes détectent la Release au prochain lancement. L'exe n'est pas signé : Windows SmartScreen affiche un avertissement à la première installation.
