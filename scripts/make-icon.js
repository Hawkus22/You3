// Génère assets/icon.png (512x512) à partir d'un SVG, en utilisant Electron pour le rendu.
// Usage : npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff5f6d"/>
      <stop offset="1" stop-color="#ff8a4c"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.22"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#shine)"/>
  <!-- triangle "play" : la vidéo -->
  <path d="M112 156 L112 356 Q112 380 133 368 L282 268 Q300 256 282 244 L133 144 Q112 132 112 156 Z"
        fill="#fff" transform="translate(0 0)"/>
  <!-- barres d'égaliseur : l'audio -->
  <rect x="318" y="226" width="34" height="60" rx="17" fill="#14161c"/>
  <rect x="366" y="176" width="34" height="160" rx="17" fill="#14161c"/>
  <rect x="414" y="206" width="34" height="100" rx="17" fill="#14161c"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.svg'), svg.trim());
  // Même icône pour l'extension navigateur (Firefox : 48/96 ; Chrome : 16/48/128).
  const extDir = path.join(__dirname, '..', 'extension', 'icons');
  fs.mkdirSync(extDir, { recursive: true });
  for (const n of [16, 32, 48, 96, 128]) {
    fs.writeFileSync(path.join(extDir, `icon-${n}.png`), img.resize({ width: n, height: n, quality: 'best' }).toPNG());
  }
  console.log('Icône écrite :', out);
  app.quit();
});
