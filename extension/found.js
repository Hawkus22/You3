const q = new URLSearchParams(location.search);
document.getElementById('head').textContent = q.get('where') === 'playou3' ? 'Déjà dans Playou3' : 'Déjà téléchargé avec You3';
document.getElementById('title').textContent = q.get('title') || '';
document.getElementById('path').textContent = q.get('path') || '';
document.getElementById('ok').addEventListener('click', () => window.close());
document.getElementById('copy').addEventListener('click', async (e) => {
  await navigator.clipboard.writeText(q.get('path') || '');
  e.target.textContent = 'Copié ✓';
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && window.close());
