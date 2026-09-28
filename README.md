# You3

Application desktop Windows (Electron + TypeScript) — Hawkus Corp.
Colle un lien YouTube (ou importe un `.txt`, un lien par ligne) : l'audio est récupéré avec **yt-dlp**, converti en MP3 par **ffmpeg** (320 kbps par défaut) et enregistré dans le dossier Téléchargements de Windows.

## Lancer

```
npm install
npm run start      # compile puis lance l'application
npm run dist       # installeur Windows -> release/You3-Setup-x.y.z.exe
npm run icon       # régénère assets/icon.png depuis le SVG de scripts/make-icon.js
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

Données utilisateur : `%APPDATA%\You3\` (`you3.db`, `logs\`, `bin\yt-dlp.exe`).

## Maintenance

- **yt-dlp** : téléchargé au premier lancement, vérifié à chaque démarrage (option désactivable), bouton de mise à jour dans l'onglet Maintenance.
- **You3** : l'onglet Maintenance lit un fichier `{ "version": "0.2.0", "url": "https://…", "notes": "…" }` à l'adresse configurée.
- Un traitement interrompu (fermeture, crash) est marqué KO au redémarrage suivant.
