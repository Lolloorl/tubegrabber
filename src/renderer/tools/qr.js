'use strict';
// QR Studio: generazione 100% locale (nessun servizio web), anteprima in tempo reale su canvas.
window.Tools = window.Tools || {};
window.Tools.qr = function (ctx) {
  const el = ctx.el, root = ctx.root;
  const canvas = el('canvas');
  const defaults = () => ({
    text: 'https://www.youtube.com', body: 'rounded', eyeFrame: 'rounded', eyeBall: 'circle', margin: 3,
    fg: '#111827', fg2: '#2563eb', gradient: false, gradDir: 'diag', bg: '#ffffff', bgTransparent: false,
    frameColors: ['#111827', '#111827', '#111827'], ballColors: ['#111827', '#111827', '#111827'], eyeSep: false,
    brush: false, brushColor: '#e11d48', logoSize: 20, logoPlate: true, plateColor: '#ffffff',
    frameStyle: 'none', frameColor: '#111827', frameText: '#ffffff', label: 'SCAN ME'
  });
  let S = defaults();
  let logo = null, logoName = '';
  const over = new Map();      // colori dei singoli moduli (pennello)
  const eyeOver = new Map();   // colori dei singoli occhi: f0/b0 ...
  let last = null, raf = 0;

  // ---------- binding input <-> stato (percorsi tipo "frameColors.1") ----------
  const getPath = (k) => k.split('.').reduce((o, p) => o[p], S);
  const setPath = (k, v) => { const p = k.split('.'); const last = p.pop(); p.reduce((o, x) => o[x], S)[last] = v; };
  const inputs = [...root.querySelectorAll('input[data-k], select[data-k]')];
  const segs = [...root.querySelectorAll('.seg[data-k]')];

  function writeUI() {
    for (const i of inputs) { const v = getPath(i.dataset.k); if (i.type === 'checkbox') i.checked = !!v; else i.value = v; }
    for (const s of segs) { const v = getPath(s.dataset.k); s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }
    el('eyesep').hidden = !S.eyeSep;
    el('brushhint').hidden = !S.brush;
    canvas.classList.toggle('brush', S.brush);
  }
  function readInput(i) {
    const k = i.dataset.k;
    let v = i.type === 'checkbox' ? i.checked : i.type === 'range' ? Number(i.value) : i.value;
    setPath(k, v);
    if (k === 'eyeSep' || k === 'brush') writeUI();
    schedule();
  }
  inputs.forEach((i) => i.addEventListener('input', () => readInput(i)));
  segs.forEach((s) => s.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; setPath(s.dataset.k, b.dataset.v); writeUI(); schedule(); }));

  // ---------- modelli di contenuto (Wi-Fi, WhatsApp, e-mail, biglietto da visita) ----------
  const textInput = root.querySelector('input[data-k="text"]');
  const F = { wifi: { sec: 'WPA' }, whatsapp: {}, email: {}, vcard: {} };
  let qrType = 'text';
  // --- accorciatore di link (solo per il tipo "Link / testo")
  const shortCache = new Map(), shortFailed = new Set();
  let shortTimer = 0, shortSeq = 0;
  const shortSay = (t, cls) => { const e = el('shortstatus'); e.textContent = t; e.className = 'hint short-status' + (cls ? ' ' + cls : ''); };
  const isUrl = (t) => /^https?:\/\/\S+$/i.test(t);
  async function requestShort(url, alias, key) {
    const my = ++shortSeq; shortSay('Accorcio il link…');
    let r; try { r = await ctx.api.shortenUrl(url, alias); } catch (e) { r = { ok: false, error: 'errore imprevisto' }; }
    if (my !== shortSeq) return;                         // nel frattempo il link o il nome sono cambiati
    if (r.ok) { shortCache.set(key, r.url); shortSay(`Link breve: ${r.url}`, 'ok'); compose(); }
    else { shortFailed.add(key); shortSay(`Non riesco ad accorciarlo: ${r.error}. Uso il link originale.`, 'err'); }
  }
  function compose() {
    if (qrType !== 'text') { S.text = window.QRTemplates.compose(qrType, F[qrType]); schedule(); return; }
    const base = textInput.value.trim();
    const wants = el('shorten').checked;
    el('aliasbox').hidden = !wants;
    const alias = wants ? window.QRTemplates.normalizeAlias(el('alias').value) : '';
    if (wants) el('aliashint').textContent = alias ? `Il link sarà: https://is.gd/${alias}` : 'Lascia vuoto per un link casuale (es. is.gd/aB3dE9).';
    const key = base + '|' + alias;
    S.text = wants && isUrl(base) && shortCache.has(key) ? shortCache.get(key) : textInput.value;
    schedule();
    clearTimeout(shortTimer);
    if (!wants) { shortSay(''); return; }
    if (!isUrl(base)) { shortSay('Scrivi un link che inizi con http:// o https://', 'err'); return; }
    if (alias && (alias.length < 5 || alias.length > 30)) { shortSay('Il nome personalizzato deve avere da 5 a 30 caratteri (lettere, numeri e _).', 'err'); return; }
    if (base.length <= 28 && !alias) { shortSay('Il link è già corto: non serve accorciarlo.'); return; }
    if (shortCache.has(key)) { shortSay(`Link breve: ${shortCache.get(key)}`, 'ok'); return; }
    if (shortFailed.has(key)) return;
    shortSay('Attendo che finisci di scrivere…');
    shortTimer = setTimeout(() => requestShort(base, alias, key), 800);   // non si contatta il servizio a ogni lettera
  }
  el('shorten').addEventListener('change', () => { shortFailed.clear(); compose(); });
  el('alias').addEventListener('input', compose);
  function setType(t) {
    qrType = t;
    el('qrtype').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === t));
    root.querySelectorAll('[data-type]').forEach((g) => { g.hidden = g.dataset.type !== t; });
    compose();
  }
  el('qrtype').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setType(b.dataset.v); });
  root.querySelectorAll('[data-f]').forEach((i) => {
    const [t, k] = i.dataset.f.split('.');
    const read = () => { F[t][k] = i.type === 'checkbox' ? i.checked : i.value; compose(); };
    i.addEventListener('input', read); i.addEventListener('change', read);
  });
  textInput.addEventListener('input', () => { if (qrType === 'text') compose(); });

  // ---------- preset ----------
  const PRESETS = {
    classic: { body: 'square', eyeFrame: 'square', eyeBall: 'square', gradient: false, fg: '#000000', frameColors: ['#000000', '#000000', '#000000'], ballColors: ['#000000', '#000000', '#000000'], bg: '#ffffff', eyeSep: false },
    soft:    { body: 'rounded', eyeFrame: 'rounded', eyeBall: 'rounded', gradient: false, fg: '#1f2937', frameColors: ['#1f2937', '#1f2937', '#1f2937'], ballColors: ['#2563eb', '#2563eb', '#2563eb'], bg: '#ffffff', eyeSep: false },
    dots:    { body: 'dots', eyeFrame: 'circle', eyeBall: 'circle', gradient: false, fg: '#0f766e', frameColors: ['#0f766e', '#0f766e', '#0f766e'], ballColors: ['#0f766e', '#0f766e', '#0f766e'], bg: '#ffffff', eyeSep: false },
    aurora:  { body: 'rounded', eyeFrame: 'rounded', eyeBall: 'circle', gradient: true, gradDir: 'diag', fg: '#4338ca', fg2: '#db2777', frameColors: ['#4338ca', '#4338ca', '#4338ca'], ballColors: ['#db2777', '#db2777', '#db2777'], bg: '#ffffff', eyeSep: false }
  };
  el('presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    Object.assign(S, JSON.parse(JSON.stringify(PRESETS[b.dataset.preset]))); over.clear(); eyeOver.clear(); writeUI(); schedule();
  });

  // ---------- geometria ----------
  const eyes = (n) => [[0, 0], [0, n - 7], [n - 7, 0]];
  function eyeAt(r, c, n) {
    const E = eyes(n);
    for (let i = 0; i < 3; i++) if (r >= E[i][0] && r < E[i][0] + 7 && c >= E[i][1] && c < E[i][1] + 7) return { i, lr: r - E[i][0], lc: c - E[i][1] };
    return null;
  }
  function rr(c, x, y, w, h, r) { c.roundRect(x, y, w, h, r); }
  function shapePath(c, x, y, w, h, shape, k) {
    if (shape === 'circle') { c.moveTo(x + w, y + h / 2); c.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2); }
    else if (shape === 'rounded') rr(c, x, y, w, h, w * (k || 0.28));
    else c.rect(x, y, w, h);
  }
  function layout(size) {
    if (S.frameStyle === 'none') return { W: size, H: size, bx: 0, by: 0, bw: size, b: 0 };
    const b = size * 0.045;
    if (S.frameStyle === 'border') return { W: size, H: size, bx: b, by: b, bw: size - 2 * b, b };
    const lab = size * 0.15;
    return { W: size, H: size + lab, bx: b, by: b, bw: size - 2 * b, b, lab };
  }

  function makeMatrix(text) {
    window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
    // correzione errori: H (30%) solo se c'e un logo da coprire; senza logo basta M (15%) e il QR e meno fitto
    const qr = window.qrcode(0, logo ? 'H' : 'M');
    qr.addData(text || ' '); qr.make();
    return qr;
  }

  // ---------- disegno ----------
  function draw(cv, size) {
    const qr = makeMatrix(S.text); const n = qr.getModuleCount();
    const L = layout(size); cv.width = Math.round(L.W); cv.height = Math.round(L.H);
    const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height);
    const framed = S.frameStyle !== 'none';

    if (framed) { c.fillStyle = S.frameColor; c.beginPath(); rr(c, 0, 0, L.W, L.H, size * 0.05); c.fill(); }
    if (framed || !S.bgTransparent) {
      c.fillStyle = S.bgTransparent ? '#ffffff' : S.bg; c.beginPath();
      if (framed) rr(c, L.bx, L.by, L.bw, L.bw, size * 0.03); else c.rect(0, 0, size, size); c.fill();
    }

    const m = S.margin, cell = L.bw / (n + 2 * m), ox = L.bx + m * cell, oy = L.by + m * cell, span = n * cell;
    let base = S.fg;
    if (S.gradient) {
      const g = S.gradDir === 'h' ? c.createLinearGradient(ox, 0, ox + span, 0) : S.gradDir === 'v' ? c.createLinearGradient(0, oy, 0, oy + span) : c.createLinearGradient(ox, oy, ox + span, oy + span);
      g.addColorStop(0, S.fg); g.addColorStop(1, S.fg2); base = g;
    }

    // zona del logo (i moduli sotto la base vengono omessi)
    let plate = null;
    if (logo) {
      const box = L.bw * (S.logoSize / 100), sc = Math.min(box / logo.width, box / logo.height);
      const lw = logo.width * sc, lh = logo.height * sc, pad = L.bw * 0.02, cx = L.bx + L.bw / 2, cy = L.by + L.bw / 2;
      plate = { x: cx - lw / 2 - pad, y: cy - lh / 2 - pad, w: lw + 2 * pad, h: lh + 2 * pad, lx: cx - lw / 2, ly: cy - lh / 2, lw, lh };
    }
    const hidden = (x, y) => plate && x + cell > plate.x - cell * 0.3 && x < plate.x + plate.w + cell * 0.3 && y + cell > plate.y - cell * 0.3 && y < plate.y + plate.h + cell * 0.3;

    // moduli del corpo
    for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) {
      if (!qr.isDark(r, q) || eyeAt(r, q, n)) continue;
      const x = ox + q * cell, y = oy + r * cell;
      if (hidden(x, y)) continue;
      c.fillStyle = over.get(r + ',' + q) || base; c.beginPath();
      if (S.body === 'dots') { c.arc(x + cell / 2, y + cell / 2, cell * 0.47, 0, Math.PI * 2); }
      else if (S.body === 'rounded') rr(c, x + cell * 0.03, y + cell * 0.03, cell * 0.94, cell * 0.94, cell * 0.34);
      else if (S.body === 'diamond') { c.moveTo(x + cell / 2, y - cell * 0.04); c.lineTo(x + cell * 1.04, y + cell / 2); c.lineTo(x + cell / 2, y + cell * 1.04); c.lineTo(x - cell * 0.04, y + cell / 2); c.closePath(); }
      else c.rect(x - 0.25, y - 0.25, cell + 0.5, cell + 0.5);
      c.fill();
    }

    // occhi (3 angoli): cornice 7x7 con foro 5x5 + centro 3x3
    eyes(n).forEach(([r, q], i) => {
      const x = ox + q * cell, y = oy + r * cell;
      const fc = eyeOver.get('f' + i) || (S.eyeSep ? S.frameColors[i] : S.frameColors[0]);
      const bc = eyeOver.get('b' + i) || (S.eyeSep ? S.ballColors[i] : S.ballColors[0]);
      c.fillStyle = fc; c.beginPath();
      shapePath(c, x, y, 7 * cell, 7 * cell, S.eyeFrame, 0.3); shapePath(c, x + cell, y + cell, 5 * cell, 5 * cell, S.eyeFrame, 0.22);
      c.fill('evenodd');
      c.fillStyle = bc; c.beginPath(); shapePath(c, x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell, S.eyeBall, 0.3); c.fill();
    });

    if (plate) {
      if (S.logoPlate) { c.fillStyle = S.plateColor; c.beginPath(); rr(c, plate.x, plate.y, plate.w, plate.h, cell * 0.8); c.fill(); }
      c.drawImage(logo, plate.lx, plate.ly, plate.lw, plate.lh);
    }

    if (S.frameStyle === 'label') {
      c.fillStyle = S.frameText; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `700 ${Math.round(size * 0.075)}px "Segoe UI",system-ui,sans-serif`;
      c.fillText(S.label, L.W / 2, L.by + L.bw + (L.H - L.by - L.bw) / 2 + 1);
    }
    return { n, ox, oy, cell, W: cv.width, H: cv.height };
  }

  // ---------- leggibilita ----------
  const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function checkReadable() {
    const w = el('warn'); const bg = S.frameStyle !== 'none' || !S.bgTransparent ? (S.frameStyle !== 'none' && S.bgTransparent ? '#ffffff' : S.bg) : '#ffffff';
    const fgs = [S.fg, ...(S.gradient ? [S.fg2] : []), S.frameColors[0], ...(S.eyeSep ? S.frameColors : [])];
    const worst = Math.min(...fgs.map((f) => ratio(f, bg)));
    const inverted = fgs.some((f) => lum(f) > lum(bg));
    let msg = ['ok', 'Ottima leggibilità'];
    if (S.logoSize > 24 && logo) msg = ['warn', 'Logo molto grande: prova a ridurlo'];
    if (inverted) msg = ['warn', 'Colori invertiti: alcuni lettori potrebbero non leggerlo'];
    if (worst < 3) msg = ['warn', 'Contrasto troppo basso: il QR potrebbe non essere leggibile'];
    w.className = 'qr-warn ' + msg[0]; w.textContent = msg[1];
  }

  function showDensity() {
    const n = last.n, d = el('density');
    d.className = 'qr-density' + (n > 45 ? ' dense' : '');
    d.textContent = n <= 33 ? `QR semplice (${n}×${n})` : n <= 45 ? `QR medio (${n}×${n})` : `QR molto fitto (${n}×${n}): prova ad accorciare il link`;
  }
  function render() {
    raf = 0;
    try { last = draw(canvas, 640); el('qrstatus').textContent = ''; checkReadable(); showDensity(); }
    catch (e) { el('warn').className = 'qr-warn warn'; el('warn').textContent = 'Testo troppo lungo per un QR Code'; }
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(render); }

  // ---------- pennello: colora singoli blocchi ----------
  function hit(e) {
    if (!last) return null; const b = canvas.getBoundingClientRect();
    const px = (e.clientX - b.left) * canvas.width / b.width, py = (e.clientY - b.top) * canvas.height / b.height;
    const q = Math.floor((px - last.ox) / last.cell), r = Math.floor((py - last.oy) / last.cell);
    if (q < 0 || r < 0 || q >= last.n || r >= last.n) return null;
    return { r, q };
  }
  function paint(e, erase) {
    const h = hit(e); if (!h) return;
    const eye = eyeAt(h.r, h.q, last.n);
    if (eye) { const key = (eye.lr >= 2 && eye.lr <= 4 && eye.lc >= 2 && eye.lc <= 4 ? 'b' : 'f') + eye.i; erase ? eyeOver.delete(key) : eyeOver.set(key, S.brushColor); }
    else { const key = h.r + ',' + h.q; erase ? over.delete(key) : over.set(key, S.brushColor); }
    schedule();
  }
  let painting = false;
  canvas.addEventListener('mousedown', (e) => { if (!S.brush) return; painting = true; paint(e, e.button === 2 || e.shiftKey); });
  canvas.addEventListener('mousemove', (e) => { if (painting && S.brush) paint(e, (e.buttons & 2) !== 0 || e.shiftKey); });
  window.addEventListener('mouseup', () => { painting = false; });
  canvas.addEventListener('contextmenu', (e) => { if (S.brush) e.preventDefault(); });
  el('brush-clear').addEventListener('click', () => { over.clear(); eyeOver.clear(); schedule(); });

  // ---------- logo ----------
  el('logo-pick').addEventListener('click', () => el('logo-file').click());
  el('logo-file').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => { logo = img; logoName = f.name; el('logo-name').textContent = f.name; el('logo-clear').hidden = false; schedule(); }; img.onerror = () => { el('logo-name').textContent = 'Immagine non valida'; }; img.src = fr.result; };
    fr.readAsDataURL(f); e.target.value = '';
  });
  el('logo-clear').addEventListener('click', () => { logo = null; el('logo-name').textContent = 'Nessun logo'; el('logo-clear').hidden = true; schedule(); });

  // ---------- esporta ----------
  function exportCanvas() { const cv = document.createElement('canvas'); draw(cv, 1600); return cv; }
  el('save').addEventListener('click', async () => {
    try {
      const cv = exportCanvas();
      const name = 'QRCode_' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '.png';
      const r = await ctx.api.saveImage(cv.toDataURL('image/png'), name);
      el('qrstatus').textContent = r.ok ? 'Salvato in: ' + r.path : r.canceled ? '' : 'Errore: ' + (r.error || 'salvataggio non riuscito');
    } catch (e) { el('qrstatus').textContent = 'Errore: ' + e.message; }
  });
  el('copy').addEventListener('click', async () => {
    try {
      const blob = await new Promise((res) => exportCanvas().toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      el('qrstatus').textContent = 'Copiato negli appunti';
    } catch (e) { el('qrstatus').textContent = 'Copia non disponibile: usa Salva PNG'; }
  });

  writeUI(); setType('text'); render();
};
