'use strict';

const api = window.you3;
const $ = (id) => document.getElementById(id);

/** Création d'éléments sans innerHTML (les titres viennent d'Internet). */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR') : '');

// ---- Onglets --------------------------------------------------------------

let currentTab = 'download';
function showTab(name) {
  currentTab = name;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${name}`));
  if (name === 'history') loadHistory();
  if (name === 'logs') loadLogs();
  if (name === 'maintenance') loadMaintenance();
  if (name === 'about') loadAbout();
}
$('tabs').addEventListener('click', (e) => {
  if (e.target.dataset.tab) showTab(e.target.dataset.tab);
});
api.onNav(showTab);

// ---- Ajout de liens --------------------------------------------------------

function showNotice(res) {
  const box = $('notice');
  box.replaceChildren();
  const lines = [];
  if (res.added) lines.push(`${res.added} lien(s) ajouté(s) à la file.`);
  if (res.alreadyDownloaded) lines.push(`${res.alreadyDownloaded} lien(s) déjà téléchargé(s) auparavant : à confirmer dans la file.`);
  if (res.alreadyInQueue) lines.push(`${res.alreadyInQueue} doublon(s) ignoré(s).`);
  if (!lines.length && !res.invalid.length) lines.push('Aucun lien YouTube reconnu.');
  box.append(...lines.map((l) => h('div', {}, l)));
  if (res.invalid.length) {
    box.append(h('div', {}, `${res.invalid.length} entrée(s) ignorée(s) :`), h('ul', {}, res.invalid.slice(0, 8).map((i) => h('li', {}, `${i.text} — ${i.reason}`))));
  }
  box.classList.toggle('err', !res.added && !res.alreadyDownloaded);
  box.classList.remove('hidden');
}

async function addFromInput() {
  const text = $('urlInput').value;
  if (!text.trim()) return;
  showNotice(await api.queue.add(text));
  $('urlInput').value = '';
}
$('btnAdd').addEventListener('click', addFromInput);
$('urlInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    addFromInput();
  }
});
$('urlInput').addEventListener('paste', () => setTimeout(() => $('urlInput').value.trim() && addFromInput(), 0));

async function importTxt(path) {
  try {
    await api.queue.importTxt(path); // le résultat arrive via onImportResult
  } catch (e) {
    showNotice({ added: 0, alreadyDownloaded: 0, alreadyInQueue: 0, invalid: [{ text: 'Import', reason: String(e.message || e).replace(/^.*Error: /, '') }] });
  }
}
$('btnImport').addEventListener('click', () => importTxt());
api.onImportResult(showNotice);
$('btnOpenDl').addEventListener('click', () => api.fs.openDownloads());

// Glisser-déposer d'un .txt
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dragging');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (file) {
    showTab('download');
    importTxt(api.pathForFile(file));
  }
});

// ---- File d'attente --------------------------------------------------------

function queueItem(it) {
  const badgeMap = {
    pending: ['wait', 'En attente'],
    duplicate: ['wait', 'Déjà téléchargé'],
    running: ['run', it.phase || 'En cours'],
    done: ['ok', 'OK'],
    error: ['ko', 'KO'],
  };
  const [cls, label] = badgeMap[it.status];
  const main = h('div', { class: 'main' }, h('div', { class: 'title' }, it.title || it.url));
  if (it.status === 'running') {
    main.append(
      h('div', { class: 'sub' }, `${it.percent.toFixed(0)} %${it.speed ? ` · ${it.speed}` : ''}`),
      h('div', { class: 'bar' }, h('i', { style: false })),
    );
    main.querySelector('.bar > i').style.width = `${Math.min(100, it.percent)}%`;
  } else if (it.status === 'duplicate' && it.previous) {
    const missing = it.previous.fileExists ? '' : ' (fichier introuvable sur le disque)';
    main.append(h('div', { class: 'sub warn' }, `Déjà converti le ${fmtDate(it.previous.date)}${missing}`));
  } else if (it.status === 'done') {
    main.append(h('div', { class: 'sub' }, it.filePath));
  } else if (it.status === 'error') {
    main.append(h('div', { class: 'sub err wrap' }, it.message));
  } else {
    main.append(h('div', { class: 'sub' }, it.url));
  }

  const btns = h('div', { class: 'btns' });
  if (it.status === 'duplicate') btns.append(h('button', { class: 'small', onclick: () => api.queue.requeue(it.id) }, 'Retélécharger'));
  if (it.status === 'error') btns.append(h('button', { class: 'small', onclick: () => api.queue.requeue(it.id) }, 'Réessayer'));
  if (it.status === 'done') btns.append(h('button', { class: 'small', onclick: () => api.fs.showInFolder(it.filePath) }, 'Afficher'));
  btns.append(h('button', { class: 'small', title: it.status === 'running' ? 'Annuler' : 'Retirer', onclick: () => api.queue.remove(it.id) }, it.status === 'running' ? 'Annuler' : '✕'));

  return h('li', { class: 'item' }, h('span', { class: `badge ${cls}` }, label), main, btns);
}

function renderQueue(items) {
  $('queueList').replaceChildren(...items.map(queueItem));
  $('queueEmpty').classList.toggle('hidden', items.length > 0);
}
api.onQueue(renderQueue);
api.queue.list().then(renderQueue);
$('btnCancelAll').addEventListener('click', () => api.queue.cancelAll());
$('btnClearDone').addEventListener('click', () => api.queue.clearFinished());

// ---- Historique -------------------------------------------------------------

async function loadHistory() {
  const [rows, stats] = await Promise.all([api.history.list($('histSearch').value, $('histStatus').value), api.history.stats()]);
  $('histStats').textContent = `${stats.ok} OK · ${stats.ko} KO`;
  $('histEmpty').classList.toggle('hidden', rows.length > 0);
  $('histList').replaceChildren(
    ...rows.map((r) => {
      const ok = r.status === 'OK';
      const main = h(
        'div',
        { class: 'main' },
        h('div', { class: 'title' }, r.title || r.url),
        h('div', { class: 'sub' }, `${fmtDate(r.finished_at)} · ${r.bitrate} kbps · ${r.url}`),
        ok ? h('div', { class: 'sub' }, r.file_path) : h('div', { class: 'sub err wrap' }, r.error_message),
      );
      const btns = h('div', { class: 'btns' });
      if (ok) btns.append(h('button', { class: 'small', onclick: async () => ((await api.fs.showInFolder(r.file_path)) || alert('Le fichier a été déplacé ou supprimé.')) }, 'Afficher'));
      btns.append(
        h('button', { class: 'small', onclick: async () => {
          const res = await api.queue.add(r.url);
          showTab('download');
          showNotice(res);
        } }, ok ? 'Retélécharger' : 'Réessayer'),
        h('button', { class: 'small', title: 'Supprimer de l\'historique', onclick: async () => { await api.history.delete(r.id); loadHistory(); } }, '✕'),
      );
      return h('li', { class: 'item' }, h('span', { class: `badge ${ok ? 'ok' : 'ko'}` }, r.status), main, btns);
    }),
  );
}
let histTimer;
$('histSearch').addEventListener('input', () => {
  clearTimeout(histTimer);
  histTimer = setTimeout(loadHistory, 200);
});
$('histStatus').addEventListener('change', loadHistory);
$('btnHistClear').addEventListener('click', async () => {
  if (confirm("Vider tout l'historique ? La détection des doublons sera perdue.")) {
    await api.history.clear();
    loadHistory();
  }
});
// L'historique se met à jour quand la file se termine
api.onQueue((items) => {
  if (currentTab === 'history' && !items.some((i) => i.status === 'running')) loadHistory();
});

// ---- Journal ------------------------------------------------------------------

async function loadLogs() {
  const rows = await api.logs.list($('logLevel').value, $('logSearch').value);
  $('logFile').textContent = `Fichier du jour : ${await api.logs.currentFile()}`;
  $('logList').replaceChildren(
    ...rows.map((r) =>
      h('div', { class: 'logline' },
        h('span', { class: 'ts' }, `${fmtDate(r.ts)} `),
        h('span', { class: `lvl ${r.level}` }, r.level),
        h('span', { class: 'ts' }, `[${r.source}]${r.download_id ? ` #${r.download_id}` : ''} `),
        r.message),
    ),
  );
  if (!rows.length) $('logList').append(h('div', { class: 'empty' }, 'Aucune entrée.'));
}
let logTimer;
const scheduleLogs = () => {
  clearTimeout(logTimer);
  logTimer = setTimeout(loadLogs, 200);
};
$('logLevel').addEventListener('change', loadLogs);
$('logSearch').addEventListener('input', scheduleLogs);
api.onLogsChanged(() => currentTab === 'logs' && scheduleLogs());
$('btnLogFolder').addEventListener('click', () => api.logs.openFolder());
$('btnLogClear').addEventListener('click', async () => {
  if (confirm('Vider le journal en base ? (les fichiers .log sont conservés)')) {
    await api.logs.clear();
    loadLogs();
  }
});

// ---- Maintenance -----------------------------------------------------------------

async function loadMaintenance() {
  const [st, settings, info] = await Promise.all([api.tools.status(), api.settings.get(), api.app.info()]);
  $('ytdlpState').textContent = st.ytdlpInstalled ? `Installé — version ${st.ytdlpVersion}` : 'Non installé (nécessaire pour télécharger)';
  $('ffmpegState').textContent = st.ffmpegOk ? `Opérationnel — ${st.ffmpegVersion}` : 'ffmpeg introuvable : réinstallez l\'application';
  $('setBitrate').value = String(settings.bitrate);
  $('setAutoUpdate').checked = settings.autoUpdateYtdlp;
  $('setUpdateUrl').value = settings.updateUrl;
  $('appVersionLine').textContent = `Version installée : ${info.version}`;
}
api.onToolsChanged(() => currentTab === 'maintenance' && loadMaintenance());
api.onToolsBusy((busy) => $('toolsBusy').classList.toggle('hidden', !busy));

$('setBitrate').addEventListener('change', (e) => api.settings.set({ bitrate: Number(e.target.value) }));
$('setAutoUpdate').addEventListener('change', (e) => api.settings.set({ autoUpdateYtdlp: e.target.checked }));
$('setUpdateUrl').addEventListener('change', (e) => api.settings.set({ updateUrl: e.target.value }));

$('btnCheckYtdlp').addEventListener('click', async () => {
  $('ytdlpMsg').textContent = 'Vérification…';
  const r = await api.tools.checkYtdlp();
  $('ytdlpMsg').textContent = !r.ok
    ? `Vérification impossible : ${r.error}`
    : r.upToDate
      ? `yt-dlp est à jour (${r.current}).`
      : `Mise à jour disponible : ${r.current || 'non installé'} → ${r.latest}`;
});
$('btnUpdateYtdlp').addEventListener('click', async () => {
  $('btnUpdateYtdlp').disabled = true;
  $('ytdlpMsg').textContent = 'Téléchargement de yt-dlp…';
  const r = await api.tools.updateYtdlp();
  $('ytdlpMsg').textContent = r.ok ? `yt-dlp installé : version ${r.version}` : `Échec : ${r.error}`;
  $('btnUpdateYtdlp').disabled = false;
  loadMaintenance();
});
$('btnCheckApp').addEventListener('click', async () => {
  const box = $('appUpdateMsg');
  box.replaceChildren('Vérification…');
  const r = await api.app.checkUpdate();
  if (!r.ok) return box.replaceChildren(`Vérification impossible : ${r.error}`);
  if (!r.configured) return box.replaceChildren('Aucune adresse configurée : renseignez le fichier de version ci-dessus.');
  if (r.upToDate) return box.replaceChildren(`You3 est à jour (${r.current}).`);
  box.replaceChildren(`Version ${r.latest} disponible${r.notes ? ` — ${r.notes}` : ''}. `, r.url ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.app.openExternal(r.url); } }, 'Télécharger') : '');
});
$('btnFolderDl').addEventListener('click', () => api.fs.openDownloads());
$('btnFolderLogs').addEventListener('click', () => api.logs.openFolder());
$('btnFolderData').addEventListener('click', async () => api.app.openExternal && (await api.fs.showInFolder((await api.app.info()).dbFile)));

// ---- À propos ------------------------------------------------------------------------

async function loadAbout() {
  const i = await api.app.info();
  $('aboutVersion').textContent = `Version ${i.version}`;
  const rows = [
    ['Éditeur', i.author],
    ['Electron', i.electron],
    ['Chromium', i.chrome],
    ['Node.js', i.node],
    ['Base de données', i.dbFile],
    ['Journaux', i.logsDir],
    ['yt-dlp', i.ytdlpFile],
    ['Téléchargements', i.downloadsDir],
  ];
  $('aboutTable').replaceChildren(...rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v))));
}
