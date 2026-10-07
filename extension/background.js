// Firefox expose `browser`, Chrome `chrome` : même code pour les deux (Manifest V3).
const ext = globalThis.browser ?? globalThis.chrome;
const BASE = 'http://127.0.0.1:47803';

const today = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale

function flash(tabId, text, color) {
  if (tabId == null) return;
  ext.action.setBadgeBackgroundColor({ color, tabId });
  ext.action.setBadgeText({ text, tabId });
  // Le service worker de Chrome peut s'arrêter : l'alarme efface le badge même dans ce cas.
  ext.alarms.create(`clear-${tabId}`, { delayInMinutes: 0.05 });
}
ext.alarms.onAlarm.addListener((a) => {
  if (a.name.startsWith('clear-')) ext.action.setBadgeText({ text: '', tabId: Number(a.name.slice(6)) });
  else if (a.name === 'day') refreshPopup();
});

function notify(title, message) {
  ext.notifications.create({ type: 'basic', iconUrl: 'icons/icon-128.png', title, message });
}

async function post(route, url) {
  const r = await fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return r.json();
}

/** Petite fenêtre au centre de la fenêtre du navigateur courante. */
async function showFound(chk, fallbackTitle) {
  const w = 460;
  const h = 230;
  const q = new URLSearchParams({ where: chk.where, title: chk.title || fallbackTitle, path: chk.path });
  const opts = { type: 'popup', url: `found.html?${q}`, width: w, height: h };
  try {
    const cur = await ext.windows.getLastFocused();
    opts.left = Math.round(cur.left + (cur.width - w) / 2);
    opts.top = Math.round(cur.top + (cur.height - h) / 2);
  } catch {
    /* position par défaut */
  }
  await ext.windows.create(opts);
}

// ---- Favoris du jour ------------------------------------------------------------------------
// Le choix est valable pour la journée en cours (folder '' = « pas de favori »).
// Tant qu'il n'est pas fait, le bouton ouvre le popup de choix ; ensuite le clic envoie directement.

async function dayChoice() {
  const { fav } = await ext.storage.local.get('fav');
  return fav && fav.day === today() ? fav : null;
}

async function refreshPopup() {
  await ext.action.setPopup({ popup: (await dayChoice()) ? '' : 'popup.html' });
}

async function bookmark(url, title, folderId) {
  if (!folderId) return;
  try {
    const existing = await ext.bookmarks.search({ url });
    if (existing.length) return; // déjà en favori quelque part : on n'ajoute rien
    await ext.bookmarks.create({ parentId: folderId, title: title || url, url });
  } catch {
    /* dossier supprimé depuis : on ignore, l'envoi à You3 reste valide */
  }
}

// ---- Envoi ----------------------------------------------------------------------------------

async function send(url, title, tabId) {
  try {
    // 1. Déjà téléchargé (You3) ou déjà dans la bibliothèque (Playou3) ?
    const chk = await post('/check', url);
    const fav = await dayChoice();
    if (chk.found) {
      await showFound(chk, title || url);
      await bookmark(url, title, fav?.folder);
      flash(tabId, '=', '#e0a020');
      return { ok: true, message: 'Déjà téléchargé' };
    }
    // 2. Envoi à You3, puis favori.
    const j = await post('/add', url);
    if (j.ok) await bookmark(url, title, fav?.folder);
    flash(tabId, j.ok ? '✓' : '✗', j.ok ? '#2e9e5b' : '#d13b3b');
    if (!j.ok) notify('You3', j.message);
    return j;
  } catch {
    flash(tabId, '!', '#d13b3b');
    notify('You3', "L'application You3 n'est pas lancée");
    return { ok: false, message: "L'application You3 n'est pas lancée" };
  }
}

// Popup de choix : enregistre le dossier du jour puis envoie la page courante.
ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'choose') return false;
  (async () => {
    await ext.storage.local.set({ fav: { day: today(), folder: msg.folder } });
    await refreshPopup();
    sendResponse(await send(msg.url, msg.title, msg.tabId));
  })();
  return true; // réponse asynchrone (obligatoire pour Chrome)
});

// Clic sur l'icône (seulement quand le favori du jour est défini : plus de popup).
ext.action.onClicked.addListener((tab) => send(tab.url, tab.title, tab.id));

ext.runtime.onInstalled.addListener(() => {
  ext.contextMenus.create({ id: 'you3-link', title: 'Envoyer ce lien à You3', contexts: ['link', 'page'] });
  ext.contextMenus.create({ id: 'you3-reset', title: 'Changer le favori du jour', contexts: ['action'] });
});
ext.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'you3-reset') {
    await ext.storage.local.remove('fav');
    return refreshPopup();
  }
  send(info.linkUrl || info.pageUrl, info.linkUrl ? info.linkText : tab.title, tab.id);
});

// Le choix expire à minuit même si le navigateur reste ouvert (vérifié chaque minute).
refreshPopup();
ext.alarms.create('day', { periodInMinutes: 1 });
ext.tabs.onActivated.addListener(refreshPopup);
