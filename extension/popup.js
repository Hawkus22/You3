const ext = globalThis.browser ?? globalThis.chrome;
const sel = document.getElementById('folder');
const NONE = '__none__';

function collectFolders(nodes, depth, out) {
  for (const n of nodes) {
    if (n.url || !n.children) continue; // dossiers uniquement
    if (n.parentId) out.push({ id: n.id, label: `${'  '.repeat(depth)}${n.title || 'Favoris'}` });
    collectFolders(n.children, n.parentId ? depth + 1 : depth, out);
  }
}

async function init() {
  const folders = [];
  collectFolders(await ext.bookmarks.getTree(), 0, folders);
  sel.append(new Option('— Choisir —', ''));
  sel.append(new Option("Pas de favori aujourd'hui", NONE));
  for (const f of folders) sel.append(new Option(f.label, f.id));
}

sel.addEventListener('change', async () => {
  if (!sel.value) return;
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  await ext.runtime.sendMessage({
    type: 'choose',
    folder: sel.value === NONE ? '' : sel.value,
    url: tab.url,
    title: tab.title,
    tabId: tab.id,
  });
  window.close();
});

init();
