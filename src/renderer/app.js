'use strict';
// Shell dell'applicazione: schede in stile browser, Home, barra comune, aggiornamenti.
(function () {
  const api = window.api;
  const TOOLS = {
    home:     { name: 'Home',        color: '#8b93a7', dock: false },
    youtube:  { name: 'Scarica',     color: '#ff5a5f', dock: true },
    convert:  { name: 'Converti',    color: '#f2a93b', dock: true },
    drone:    { name: 'Drone Sync',  color: '#9b7bff', dock: true },
    qr:       { name: 'QR Studio',   color: '#2fc4b2', dock: false },
    settings: { name: 'Impostazioni', color: '#8b93a7', dock: false }
  };
  const tabs = new Map();
  const settings = {};            // unico oggetto condiviso: gli strumenti lo leggono e lo aggiornano
  let activeId = null, seq = 0, appInfo = null;
  let recipes = [];            // strumenti extra (ricette) gia validati dal programma
  async function loadRecipes(refresh) { const i = await (refresh ? api.refreshRecipes() : api.listRecipes()); recipes = i.tools || []; return i; }

  const $ = (s, r = document) => r.querySelector(s);
  const tabsEl = $('#tabs'), panelsEl = $('#panels');
  if (api.platform === 'darwin') document.body.classList.add('mac');

  const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
  const baseName = (p) => String(p).split(/[\\/]/).pop();
  const saveSettings = (patch) => { Object.assign(settings, patch); return api.setSettings(patch); };

  function makeDrop(el, onPaths, pickOpts) {
    el.addEventListener('dragenter', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); el.classList.remove('over');
      const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
      if (paths.length) onPaths(paths);
    });
    const pick = async () => { const p = await api.pickFiles(pickOpts || {}); if (p.length) onPaths(p); };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  }

  // ---------- barra comune: cartella output, avanzamento, annulla, segnala errore ----------
  function createDock(tab) {
    const root = $('#tpl-dock').content.firstElementChild.cloneNode(true);
    const el = (n) => root.querySelector(`[data-el="${n}"]`);
    let details = '';
    el('outdir').value = settings.outDir || ''; el('openfolder').checked = !!settings.openFolder;
    const save = () => saveSettings({ outDir: el('outdir').value, openFolder: el('openfolder').checked });
    el('outdir').addEventListener('change', save); el('openfolder').addEventListener('change', save);
    el('browse').addEventListener('click', async () => { const d = await api.pickFolder(el('outdir').value); if (d) { el('outdir').value = d; save(); } });
    el('cancel').addEventListener('click', () => { api.cancelJob(tab.id); setStatus('Annullamento in corso…', 'warn'); });
    el('send').addEventListener('click', () => openReport(details, `Errore TubeGrabber (${tab.name})`));
    el('copydet').addEventListener('click', async () => { await api.copyText(details); setStatus('Dettagli copiati negli appunti.', 'info'); });

    function setStatus(text, level) { const s = el('status'); s.textContent = text; s.className = 'status' + (level ? ' ' + level : ''); }
    function setProgress(v) { v = Math.max(0, Math.min(1, v)); el('bar').style.transform = `scaleX(${v})`; tab.tabEl.style.setProperty('--p', v); }
    function setBusy(b) {
      tab.busy = b; tab.tabEl.classList.toggle('busy', b); el('cancel').disabled = !b;
      tab.panel.querySelectorAll('[data-el^="go"]').forEach((x) => { x.disabled = b; });
      if (b) el('report').hidden = true;
    }
    function showReport(d) { details = d || ''; el('report').hidden = !details; }
    async function start(tool, payload) {
      if (tab.busy) return false;
      const outDir = el('outdir').value.trim();
      if (!outDir) { setStatus('Scegli una cartella di output.', 'error'); return false; }
      setProgress(0); setBusy(true); setStatus('Avvio…', 'info');
      const r = await api.startJob(tab.id, tool, { ...payload, outDir, openFolder: el('openfolder').checked });
      if (!r.ok) { setBusy(false); setStatus(r.error || 'Impossibile avviare.', 'error'); return false; }
      return true;
    }
    return { root, setStatus, setProgress, setBusy, showReport, start };
  }

  // ---------- schede ----------
  function newTab(tool) {
    const id = 't' + (++seq);
    const panel = document.createElement('section'); panel.className = 'panel';
    const tabEl = document.createElement('div'); tabEl.className = 'tab'; tabEl.setAttribute('role', 'tab');
    tabEl.innerHTML = '<span class="dot"></span><span class="title"></span><button class="x" aria-label="Chiudi scheda" title="Chiudi (Ctrl+W)">✕</button><span class="bar"></span>';
    const tab = { id, tool: null, panel, tabEl, busy: false, ctx: null };
    tabEl.addEventListener('click', (e) => { if (e.target.closest('.x')) closeTab(id); else activate(id); });
    tabEl.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(id); });
    tabs.set(id, tab); tabsEl.appendChild(tabEl); panelsEl.appendChild(panel);
    buildTool(tab, tool);
    activate(id);
    return tab;
  }

  // Riempie (o sostituisce) il contenuto di una scheda con uno strumento
  function buildTool(tab, tool) {
    if (tab.busy) return;
    const rec = tool.startsWith('recipe:') ? recipes.find((x) => x.id === tool.slice(7)) : null;
    if (tool.startsWith('recipe:') && !rec) { tool = 'home'; }
    const def = rec ? { name: rec.name, color: rec.color || '#8b93a7', dock: true } : TOOLS[tool];
    tab.name = def.name;
    tab.panel.textContent = ''; tab.panel.style.setProperty('--tool', def.color);
    tab.tabEl.style.setProperty('--tool', def.color); tab.tabEl.style.setProperty('--p', 0);
    tab.tabEl.querySelector('.title').textContent = def.name;
    const body = document.createElement('div');
    const content = $(rec ? '#tpl-recipe' : '#tpl-' + tool).content.cloneNode(true);
    const contentRoot = content.firstElementChild;
    body.appendChild(content);
    if (tool === 'qr') body.style.cssText = 'flex:1;min-height:0;display:flex'; else body.className = 'scroll';
    tab.panel.appendChild(body);
    const dock = def.dock ? createDock(tab) : null;
    if (dock) tab.panel.appendChild(dock.root);
    tab.tool = tool;
    tab.ctx = {
      id: tab.id, tool, api, root: contentRoot, dock, settings, saveSettings, makeDrop, fmtSize, baseName,
      el: (n) => contentRoot.querySelector(`[data-el="${n}"]`),
      recipe: rec, recipes: () => recipes, reloadRecipes: loadRecipes,
      openTool: (t) => buildTool(tab, t),
      checkUpdates: () => checkUpdates(true), refreshTools,
      onItem: () => {}, onDone: () => {}
    };
    window.Tools[rec ? 'recipe' : tool](tab.ctx);
  }

  function activate(id) {
    activeId = id;
    for (const t of tabs.values()) { const on = t.id === id; t.tabEl.classList.toggle('active', on); t.tabEl.setAttribute('aria-selected', on); t.panel.classList.toggle('active', on); }
  }

  function closeTab(id) {
    const t = tabs.get(id); if (!t) return;
    if (t.busy && !confirm('In questa scheda c\'è un\'operazione in corso. Chiudendola verrà annullata. Vuoi continuare?')) return;
    if (t.busy) api.cancelJob(id);
    const order = [...tabs.keys()], i = order.indexOf(id);
    t.tabEl.remove(); t.panel.remove(); tabs.delete(id);
    if (!tabs.size) newTab('home');
    else if (activeId === id) activate(order[i + 1] && tabs.has(order[i + 1]) ? order[i + 1] : order[i - 1]);
  }

  function openSingleton(tool) {
    const t = [...tabs.values()].find((x) => x.tool === tool);
    if (t) activate(t.id); else newTab(tool);
  }

  api.onJobEvent((ev) => {
    const t = tabs.get(ev.id); if (!t || !t.ctx || !t.ctx.dock) return;
    const d = t.ctx.dock;
    if (ev.type === 'progress') { d.setProgress(ev.value); if (ev.text) d.setStatus(ev.text, 'info'); }
    else if (ev.type === 'status') d.setStatus(ev.text, ev.level);
    else if (ev.type === 'item') t.ctx.onItem(ev);
    else if (ev.type === 'done') {
      d.setBusy(false);
      d.setStatus(ev.message, ev.status === 'ok' ? 'ok' : ev.status === 'warn' ? 'warn' : 'error');
      d.setProgress(ev.status === 'ok' ? 1 : 0);
      d.showReport(ev.details);
      t.ctx.onDone(ev);
    }
  });

  $('#newtab').addEventListener('click', () => newTab('home'));
  $('#open-settings').addEventListener('click', () => openSingleton('settings'));
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 't') { e.preventDefault(); newTab('home'); }
    else if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); closeTab(activeId); }
    else if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault(); const ids = [...tabs.keys()]; const i = ids.indexOf(activeId);
      activate(ids[(i + (e.shiftKey ? ids.length - 1 : 1)) % ids.length]);
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // ---------- finestra "Segnala problema" ----------
  const modal = $('#report-modal');
  let rmDetails = '', rmSubject = '';
  const fullText = () => { const note = $('#rm-note').value.trim(); return (note ? `Nota dell'utente: ${note}\n\n` : '') + rmDetails; };
  function openReport(details, subject) {
    rmDetails = details || ''; rmSubject = subject || 'Problema con TubeGrabber';
    $('#rm-details').textContent = rmDetails; $('#rm-note').value = ''; $('#rm-msg').textContent = '';
    modal.hidden = false; $('#rm-note').focus();
  }
  async function sendReport(kind) {
    const r = await api.sendReport(kind, rmSubject, fullText());
    $('#rm-msg').textContent = kind === 'copy'
      ? `Copiato! Ora scrivi a ${r.to || 'Lorenzo'} e incolla con Ctrl+V.`
      : 'Si è aperta la tua posta con il messaggio pronto: premi Invia. Il testo completo è anche negli appunti (Ctrl+V). Se non si apre nulla, usa "Copia tutto".';
  }
  $('#rm-gmail').addEventListener('click', () => sendReport('gmail'));
  $('#rm-mail').addEventListener('click', () => sendReport('mailto'));
  $('#rm-copy').addEventListener('click', () => sendReport('copy'));
  $('#rm-close').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) modal.hidden = true; });
  $('#open-report').addEventListener('click', async () => openReport(await api.supportBase(), 'Problema con TubeGrabber'));

  // ---------- avvisi e aggiornamenti ----------
  let noticeTimer = 0;
  function showNotice(text) { const n = $('#notice'); n.textContent = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { n.textContent = ''; }, 9000); }
  api.onNotice((t) => { showNotice(t); refreshTools(); });

  const banner = $('#banner');
  function showBanner(u) {
    $('#banner-title').textContent = `Aggiornamento ${u.mandatory ? 'necessario' : 'consigliato'}: TubeGrabber ${u.version}`;
    $('#banner-notes').textContent = u.notes || `Stai usando la versione ${u.current}.`;
    banner.classList.toggle('mandatory', !!u.mandatory);
    $('#banner-later').hidden = !!u.mandatory;
    const get = $('#banner-get'); get.hidden = !u.url; get.onclick = () => api.openExternal(u.url);
    $('#banner-later').onclick = () => { localStorage.setItem('dismissedVersion', u.version); banner.hidden = true; };
    banner.hidden = false;
  }
  async function checkUpdates(manual) {
    if (manual) showNotice('Controllo aggiornamenti…');
    const u = await api.checkUpdate();
    if (u.status === 'available') {
      if (manual || u.mandatory || localStorage.getItem('dismissedVersion') !== u.version) showBanner(u);
      if (manual) showNotice(`Disponibile la versione ${u.version}`);
    } else if (manual) {
      showNotice(u.status === 'up-to-date' ? 'Hai già l\'ultima versione.' : u.status === 'not-configured' ? 'Server aggiornamenti non configurato.' : (u.message || 'Controllo non riuscito.'));
    }
  }
  $('#checkupdate').addEventListener('click', () => checkUpdates(true));

  async function refreshTools() {
    appInfo.bins = await api.toolsStatus();
    const miss = []; if (!appInfo.bins.ytdlp) miss.push('yt-dlp'); if (!appInfo.bins.ffmpeg) miss.push('ffmpeg');
    $('#toolcheck').textContent = miss.length ? `Mancano: ${miss.join(', ')} (vedi README)` : '';
    return appInfo.bins;
  }

  // ---------- avvio ----------
  (async function init() {
    Object.assign(settings, await api.getSettings());
    appInfo = await api.info();
    $('#version').textContent = 'v' + appInfo.version;
    await refreshTools();
    await loadRecipes(false);
    newTab('home');
    if (settings.checkUpdates !== false) setTimeout(() => checkUpdates(false), 1500);
  })();
})();
