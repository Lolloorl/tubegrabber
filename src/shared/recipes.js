// Strumenti "a ricetta": una pagina descritta da dati (JSON) invece che da codice.
// Questo file e' usato sia dall'app sia dall'editor per l'admin.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Recipes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PROGRAMS = ['ffmpeg', 'yt-dlp'];
  const RESERVED = ['input', 'output', 'name', 'outdir'];
  const ICONS = ['download', 'convert', 'audio', 'scissors', 'image', 'film', 'tag', 'star', 'wave'];
  // opzioni che permetterebbero di eseguire altri programmi o leggere configurazioni: vietate
  const DENY = {
    'yt-dlp': ['--exec', '--exec-before-download', '--netrc-cmd', '--plugin-dirs', '--config-location', '--config-locations', '--batch-file', '-a', '--load-info-json', '--cookies', '--cookies-from-browser', '--downloader-args', '--use-postprocessor', '--ffmpeg-location', '--js-runtimes'],
    ffmpeg: ['-report', '-passlogfile', '-dump_attachment', '-attach', '-filter_script', '-filter_complex_script', '-init_hw_device', '-protocol_whitelist']
  };
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

  function validate(r) {
    const e = [];
    if (!r || typeof r !== 'object' || Array.isArray(r)) return ['La ricetta non è un oggetto valido.'];
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(r.id || '')) e.push('"id": usa solo lettere minuscole, numeri e trattini (da 3 a 40 caratteri), es. "estrai-audio".');
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 40) e.push('"name": serve un nome (massimo 40 caratteri).');
    for (const k of ['tagline', 'description', 'button']) if (r[k] != null && (typeof r[k] !== 'string' || r[k].length > 400)) e.push(`"${k}": deve essere un testo (massimo 400 caratteri).`);
    if (r.examples != null && (!Array.isArray(r.examples) || r.examples.length > 5 || r.examples.some((x) => typeof x !== 'string'))) e.push('"examples": elenco di al massimo 5 testi.');
    if (r.color != null && !/^#[0-9a-fA-F]{6}$/.test(r.color)) e.push('"color": usa un colore come #2fc4b2.');
    if (r.icon != null && !ICONS.includes(r.icon)) e.push(`"icon": scegli tra ${ICONS.join(', ')}.`);

    const inp = r.input;
    if (!inp || !['files', 'text', 'none'].includes(inp.type)) e.push('"input.type": deve essere "files", "text" oppure "none".');
    else if (inp.type === 'files' && inp.accept != null && (!Array.isArray(inp.accept) || inp.accept.some((x) => !/^[a-z0-9]{1,5}$/i.test(x)))) e.push('"input.accept": elenco di estensioni senza punto, es. ["mp4","mov"].');

    const ids = new Set(); const opts = Array.isArray(r.options) ? r.options : [];
    if (r.options != null && !Array.isArray(r.options)) e.push('"options": deve essere un elenco.');
    if (opts.length > 12) e.push('"options": al massimo 12 opzioni.');
    opts.forEach((o, i) => {
      const w = `Opzione ${i + 1}`;
      if (!o || !/^[a-z][a-z0-9_]{0,19}$/.test(o.id || '')) return e.push(`${w}: "id" non valido (lettere minuscole, numeri e _, es. "qualita").`);
      if (RESERVED.includes(o.id)) e.push(`${w}: l'id "${o.id}" è riservato, scegline un altro.`);
      if (ids.has(o.id)) e.push(`${w}: l'id "${o.id}" è usato due volte.`); ids.add(o.id);
      if (typeof o.label !== 'string' || !o.label.trim()) e.push(`${w} (${o.id}): manca "label".`);
      if (o.type === 'choice') {
        if (!Array.isArray(o.choices) || !o.choices.length || o.choices.some((c) => !c || typeof c.value !== 'string' || typeof c.label !== 'string')) e.push(`${w} (${o.id}): "choices" deve essere un elenco di {"value","label"}.`);
        else if (!o.choices.some((c) => c.value === o.default)) e.push(`${w} (${o.id}): "default" deve essere uno dei valori di "choices".`);
      } else if (o.type === 'number') {
        if (![o.min, o.max, o.default].every(isNum) || o.min > o.max || o.default < o.min || o.default > o.max) e.push(`${w} (${o.id}): servono "min", "max" e "default" numerici, con default fra min e max.`);
      } else if (o.type === 'check') { if (typeof o.default !== 'boolean') e.push(`${w} (${o.id}): "default" deve essere true o false.`); }
      else if (o.type === 'text') { if (o.default != null && typeof o.default !== 'string') e.push(`${w} (${o.id}): "default" deve essere un testo.`); }
      else e.push(`${w} (${o.id}): "type" deve essere choice, number, check o text.`);
    });

    const run = r.run;
    if (!run || !PROGRAMS.includes(run.program)) { e.push('"run.program": deve essere "ffmpeg" oppure "yt-dlp".'); return e; }
    if (!Array.isArray(run.args) || !run.args.length) { e.push('"run.args": serve l\'elenco degli argomenti del comando.'); return e; }
    const known = new Set([...RESERVED, ...ids]);
    const flat = [];
    run.args.forEach((a, i) => {
      if (typeof a === 'string') flat.push(a);
      else if (a && typeof a === 'object' && a.when && typeof a.when === 'object' && Array.isArray(a.args) && a.args.every((x) => typeof x === 'string')) {
        for (const k of Object.keys(a.when)) if (!ids.has(k)) e.push(`Argomento ${i + 1}: "when" usa l'opzione "${k}" che non esiste.`);
        flat.push(...a.args);
      } else e.push(`Argomento ${i + 1}: deve essere un testo oppure {"when":{...},"args":[...]}.`);
    });
    if (flat.some((x) => x.length > 400)) e.push('Un argomento è troppo lungo (massimo 400 caratteri).');
    const out = run.output;
    if (out != null && typeof out !== 'string') e.push('"run.output": deve essere un testo.');
    if (run.program === 'ffmpeg') {
      if (typeof out !== 'string' || !out.trim()) e.push('"run.output": per ffmpeg serve il nome del file di uscita, es. "{name}_nuovo.mp4".');
      else if (/[\\/]|\.\./.test(out)) e.push('"run.output": deve essere solo un nome di file (senza cartelle).');
      if (run.args[run.args.length - 1] !== '{output}') e.push('L\'ultimo argomento di ffmpeg deve essere "{output}".');
    } else if (out != null && /\.\./.test(out)) e.push('"run.output": non può contenere "..".');
    if (inp && inp.type !== 'none' && !flat.concat(out || '').some((x) => placeholders(x).includes('input'))) e.push('Nei comandi manca "{input}".');
    [...flat, out || ''].forEach((s) => placeholders(s).forEach((p) => { if (!known.has(p)) e.push(`Il segnaposto {${p}} non corrisponde a nessuna opzione.`); }));
    flat.forEach((a) => { const base = a.split('=')[0]; if (DENY[run.program].includes(base)) e.push(`L'opzione "${base}" non è consentita per sicurezza.`); });
    return e;
  }

  function sanitizeValues(r, raw) {
    const v = {}; raw = raw || {};
    for (const o of r.options || []) {
      const x = raw[o.id];
      if (o.type === 'choice') v[o.id] = o.choices.some((c) => c.value === x) ? x : o.default;
      else if (o.type === 'number') { const n = Number(x); v[o.id] = isFinite(n) && x !== '' && x != null ? Math.min(o.max, Math.max(o.min, n)) : o.default; }
      else if (o.type === 'check') v[o.id] = typeof x === 'boolean' ? x : !!o.default;
      else v[o.id] = String(x == null ? (o.default || '') : x).slice(0, 200);
    }
    return v;
  }

  const expand = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  const matches = (when, values) => Object.keys(when).every((k) => String(values[k]) === String(when[k]));

  function buildArgs(r, values, ctx) {
    const vars = { ...values, ...ctx }, out = [];
    for (const a of r.run.args) {
      if (typeof a === 'string') out.push(expand(a, vars));
      else if (matches(a.when, values)) a.args.forEach((x) => out.push(expand(x, vars)));
    }
    return out;
  }

  // nome file di uscita senza caratteri vietati (solo per ffmpeg)
  const outputName = (r, values, name) => expand(r.run.output, { ...values, name }).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');

  // unisce ricette incluse e online: stesso id = vince quella online; "disabled": true la nasconde
  function merge(bundled, remote) {
    const map = new Map(); bundled.forEach((r) => map.set(r.id, r));
    (remote || []).forEach((r) => { if (r.disabled === true) map.delete(r.id); else map.set(r.id, r); });
    return [...map.values()];
  }

  return { PROGRAMS, RESERVED, ICONS, validate, sanitizeValues, buildArgs, outputName, merge, expand, placeholders };
});
