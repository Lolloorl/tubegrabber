'use strict';
window.Tools = window.Tools || {};
window.Tools.drone = function (ctx) {
  const el = ctx.el, dock = ctx.dock;
  const VIDEO = /\.(mp4|mov|avi|mkv|m4v)$/i, AUDIO = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma)$/i;
  let files = [];
  const states = new Map();
  const STATE = {
    running: ['In corso…', 'st-run'], ok: ['Unito', 'st-ok'], error: ['Errore', 'st-error'], cancelled: ['Annullato', 'st-warn'],
    noaudio: ['Senza audio abbinato', 'st-warn'], nomatch: ['Nessun video con lo stesso nome', 'st-warn']
  };
  const kind = (p) => (VIDEO.test(p) ? 'Video' : AUDIO.test(p) ? 'Audio' : 'Altro');

  function render() {
    const tb = el('rows'); tb.textContent = '';
    for (const p of files) {
      const tr = document.createElement('tr');
      const td = (t, cls) => { const c = document.createElement('td'); c.textContent = t; if (cls) c.className = cls; tr.appendChild(c); return c; };
      td(ctx.baseName(p)).title = p; td(kind(p));
      const s = states.get(p); s ? td(STATE[s][0], STATE[s][1]) : td('Pronto');
      tb.appendChild(tr);
    }
  }
  ctx.makeDrop(el('drop'), (paths) => {
    for (const p of paths) if (!files.includes(p) && kind(p) !== 'Altro') files.push(p);
    states.clear(); render();
  });
  ctx.onItem = (ev) => { states.set(ev.path, ev.state); render(); };

  el('go').addEventListener('click', () => {
    if (!files.length) { dock.setStatus('Carica prima i file del drone.', 'error'); return; }
    states.clear(); render();
    dock.start('drone', { files });
  });
};
