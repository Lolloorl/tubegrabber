'use strict';
window.Tools = window.Tools || {};
window.Tools.convert = function (ctx) {
  const el = ctx.el, dock = ctx.dock, F = window.Formats;
  let files = [], format = 'mp4';
  const states = new Map();
  const STATE = { running: ['In corso…', 'st-run'], ok: ['Fatto', 'st-ok'], error: ['Errore', 'st-error'], cancelled: ['Annullato', 'st-warn'] };

  // chip dei formati, raggruppati; i più usati sono grandi
  const groups = { popular: el('chips-popular'), video: el('chips-video'), audio: el('chips-audio'), image: el('chips-image') };
  for (const f of F.list) {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = f.label; b.dataset.id = f.id;
    b.addEventListener('click', () => select(f.id));
    (f.popular ? groups.popular : groups[f.kind]).appendChild(b);
  }
  function select(id) {
    format = id;
    ctx.root.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.id === id));
    const x264 = !!F.byId(id).x264; el('compression').disabled = !x264;
  }
  select('mp4');

  function render() {
    const ul = el('list'); ul.textContent = '';
    for (const f of files) {
      const li = document.createElement('li');
      const st = states.get(f.path);
      li.innerHTML = '<span class="nm"></span><span class="sz"></span><span class="st"></span><button class="rm" title="Rimuovi" aria-label="Rimuovi">✕</button>';
      li.querySelector('.nm').textContent = ctx.baseName(f.path); li.querySelector('.nm').title = f.path;
      if (f.size) li.querySelector('.sz').textContent = ctx.fmtSize(f.size);
      if (st) { const s = li.querySelector('.st'); s.textContent = STATE[st][0]; s.classList.add(STATE[st][1]); }
      li.querySelector('.rm').addEventListener('click', () => { files = files.filter((x) => x !== f); render(); });
      ul.appendChild(li);
    }
  }
  function add(paths) { for (const p of paths) if (!files.some((f) => f.path === p)) files.push({ path: p }); states.clear(); render(); }
  ctx.makeDrop(el('drop'), add);

  ctx.onItem = (ev) => { states.set(ev.path, ev.state); render(); };
  ctx.onDone = (ev) => { if (ev.status === 'ok') { files = []; states.clear(); render(); } };

  el('go').addEventListener('click', () => {
    if (!files.length) { dock.setStatus('Aggiungi prima i file da convertire.', 'error'); return; }
    states.clear(); render();
    dock.start('convert', { files: files.map((f) => f.path), format, compression: el('compression').value });
  });
};
