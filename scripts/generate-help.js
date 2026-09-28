// Génère dist/renderer/help.html (mode d'emploi affiché dans l'application)
// à partir de docs/MODE-EMPLOI.md, et copie les captures docs/img -> dist/renderer/img.
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const root = path.join(__dirname, '..');
const md = fs.readFileSync(path.join(root, 'docs', 'MODE-EMPLOI.md'), 'utf8');
const outDir = path.join(root, 'dist', 'renderer');

// Même règle que GitHub : minuscules, ponctuation retirée, espaces -> tirets.
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

const ids = new Set();
let html = marked.parse(md, { gfm: true });
html = html.replace(/<h([1-3])>(.*?)<\/h\1>/g, (_m, level, inner) => {
  const id = slug(inner.replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&'));
  ids.add(id);
  return `<h${level} id="${id}">${inner}</h${level}>`;
});

// Contrôle des liens internes du sommaire.
const missing = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => decodeURIComponent(m[1])).filter((a) => !ids.has(a));
if (missing.length) {
  console.error('Ancres introuvables dans le mode d\'emploi :', missing);
  process.exit(1);
}

// Les liens externes s'ouvrent dans le navigateur (géré par le processus principal).
html = html.replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener"');

const page = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self';" />
  <title>You3 : mode d'emploi</title>
  <link rel="stylesheet" href="help.css" />
</head>
<body>
  <article>
${html}
  </article>
</body>
</html>
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'help.html'), page);
fs.cpSync(path.join(root, 'docs', 'img'), path.join(outDir, 'img'), { recursive: true });
console.log(`Mode d'emploi généré (${ids.size} titres, ${(page.length / 1024).toFixed(0)} Ko).`);
