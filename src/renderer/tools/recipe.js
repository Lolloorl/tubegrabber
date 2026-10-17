'use strict';
// Pagina generica costruita da una "ricetta" (vedi src/shared/recipes.js).
window.Tools = window.Tools || {};
window.Tools.recipe = function (ctx) {
  const r = ctx.recipe, el = ctx.el, dock = ctx.dock;
  el('title').textContent = r.name;
  el('desc').textContent = r.description || r.tagline || '';
  el('go').textContent = r.button || 'Avvia';
  const STATE = { running: ['In corso…', 'st-run'], ok: ['Fatto', 'st-ok'], error: ['Errore', 'st-error'], cancelled: ['Annullato', 'st-warn'] };
  let files = [], getInputs = () => [null];
  const states = new Map();
  const box = el('input');

  // ----- ingresso: file, testo (link) o niente
  if (r.input.type === 'files') {
    const acc = (r.input.accept || []).map((x) => x.toLowerCase());
    box.innerHTML = '<div class="drop compact" tabindex="0" role="button"><strong></strong><span>oppure clicca per sceglierli</span></div><ul class="files"></ul>';
    box.querySelector('strong').textContent = r.input.label || 'Trascina qui i file';
    const ul = box.querySelector('.files');
    const render = () => {
      ul.textContent = '';
      for (const f of files) {
        const li = document.createElement('li');
        li.innerHTML = '<span class="nm"></span><span class="st"></span><button class="rm" title="Rimuovi" aria-label="Rimuovi">✕</button>';
        li.querySelector('.nm').textContent = ctx.baseName(f); li.querySelector('.nm').title = f;
        const st = states.get(f); if (st) { const s = li.querySelector('.st'); s.textContent = STATE[st][0]; s.classList.add(STATE[st][1]); }
        li.querySelector('.rm').addEventListener('click', () => { files = files.filter((x) => x !== f); render(); });
        ul.appendChild(li);
      }
    };
    const add = (paths) => {
      const okExt = (p) => !acc.length || acc.includes(p.split('.').pop().toLowerCase());
      for (const p of paths) if (okExt(p) && !files.includes(p)) files.push(p);
      states.clear(); render();
    };
    ctx.makeDrop(box.querySelector('.drop'), add, acc.length ? { filters: [{ name: 'File ammessi', extensions: acc }] } : {});
    ctx.onItem = (ev) => { states.set(ev.path, ev.state); render(); };
    ctx.onDone = (ev) => { if (ev.status === 'ok') { files = []; states.clear(); render(); } };
    getInputs = () => files;
  } else if (r.input.type === 'text') {
    box.innerHTML = '<label class="ctl full"><span></span><textarea class="field area" spellcheck="false"></textarea></label>';
    box.querySelector('span').textContent = r.input.label || 'Incolla qui (uno per riga)';
    const ta = box.querySelector('textarea');
    getInputs = () => ta.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }

  // ----- opzioni
  const reads = {};
  for (const o of r.options || []) {
    const lab = document.createElement('label');
    if (o.type === 'check') {
      lab.className = 'check'; const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!o.default;
      lab.append(i, document.createTextNode(' ' + o.label)); reads[o.id] = () => i.checked;
    } else {
      lab.className = 'ctl'; lab.append(document.createTextNode(o.label));
      let i;
      if (o.type === 'choice') { i = document.createElement('select'); i.className = 'field'; for (const c of o.choices) { const op = document.createElement('option'); op.value = c.value; op.textContent = c.label; i.appendChild(op); } i.value = o.default; }
      else { i = document.createElement('input'); i.type = o.type === 'number' ? 'number' : 'text'; i.className = 'field'; if (o.type === 'number') { i.min = o.min; i.max = o.max; i.step = 'any'; } i.value = o.default == null ? '' : o.default; }
      lab.appendChild(i); reads[o.id] = () => i.value;
    }
    el('opts').appendChild(lab);
  }
  if (!(r.options || []).length) el('opts').hidden = true;

  el('go').addEventListener('click', () => {
    const inputs = getInputs();
    if (r.input.type !== 'none' && !inputs.length) { dock.setStatus(r.input.type === 'files' ? 'Aggiungi prima i file.' : 'Inserisci almeno un link.', 'error'); return; }
    states.clear();
    const values = {}; for (const k of Object.keys(reads)) values[k] = reads[k]();
    dock.start('recipe', { id: r.id, values, inputs: r.input.type === 'none' ? [] : inputs });
  });
};
