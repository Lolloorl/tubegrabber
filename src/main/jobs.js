'use strict';
// Flussi di lavoro: ognuno riceve (job, parametri, emit, ctx) e RESTITUISCE {status, message}.
// status: ok | warn | error | cancelled
const fs = require('fs');
const path = require('path');
const { run } = require('./runner');
const yt = require('./youtube');
const drone = require('./drone');
const Formats = require('../shared/formats');

const C = require('./common');
const RC = require('../shared/recipes');
const { missing, clip, ensureDir, uniquePath, summarize } = C;

// ---------------------------------------------------------------- YOUTUBE
async function runYoutube(job, p, emit, ctx) {
  const links = (p.links || []).map((s) => String(s).trim()).filter(Boolean);
  if (!links.length) return { status: 'error', message: 'Inserisci almeno un link o una playlist.' };
  if (!ctx.bins.ytdlp) return missing('yt-dlp');
  if (p.mode === 'subs' && !['it', 'en', 'both'].includes(p.subs)) return C.fail('Scegli prima la lingua dei sottotitoli.');
  if (p.section && p.section.start) {
    if (!yt.validTime(p.section.start) || !yt.validTime(p.section.end)) return C.fail('Tratto non valido: usa secondi o mm:ss (es. 1:30).');
  }
  if (!ensureDir(p.outDir)) return { status: 'error', message: 'La cartella di output non esiste e non si riesce a crearla.' };

  const log = [];
  if (!ctx.bins.jsRuntime) log.push('AVVISO: nessun runtime JavaScript (deno/node) trovato: alcuni formati YouTube potrebbero mancare.');
  let ok = 0, errors = 0, lastErr = '', anyDownloaded = false, noSubs = false;
  const finals = new Map();   // file finale per ogni brano (l'ultimo percorso visto vince)
  const stemOf = (f) => f.replace(/\.f\d+\.[A-Za-z0-9]+$/, '').replace(/\.[A-Za-z0-9]{2,5}$/, '');

  for (let i = 0; i < links.length; i++) {
    if (job.cancelled) break;
    const pfx = links.length > 1 ? `[${i + 1}/${links.length}] ` : '';
    let itemIdx = 1, itemTot = 1, itemPct = 0, title = '';
    const args = yt.buildArgs({
      item: links[i], mode: p.mode, quality: p.quality, audioFmt: p.audioFmt, squareCover: p.squareCover,
      outDir: p.outDir, ffmpegDir: ctx.bins.ffmpegDir, jsRuntime: ctx.bins.jsRuntime,
      subs: p.subs, byChannel: p.byChannel, sectionStart: p.section && p.section.start, sectionEnd: p.section && p.section.end
    });
    emit({ type: 'status', level: 'info', text: `${pfx}Avvio download...` });

    const res = await run(job, ctx.bins.ytdlp, args, (line) => {
      let m;
      if ((m = /^\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line))) {
        itemPct = Math.max(itemPct, parseFloat(m[1]));          // evita "salti indietro" tra flusso video e audio
        const speed = /at\s+(\S+\/s)/.exec(line), eta = /ETA\s+(\S+)/.exec(line);
        emit({
          type: 'progress', value: (i + ((itemIdx - 1) + itemPct / 100) / itemTot) / links.length,
          text: `${pfx}${itemTot > 1 ? `Brano ${itemIdx}/${itemTot} · ` : ''}${Math.floor(itemPct)}%${speed ? ' · ' + speed[1] : ''}${eta ? ' · ETA ' + eta[1] : ''}${title ? '  |  ' + title : ''}`
        });
        return;
      }
      log.push(line);
      if ((m = /^\[download\]\s+Downloading item (\d+) of (\d+)/.exec(line))) { itemIdx = +m[1]; itemTot = +m[2]; itemPct = 0; }
      else if ((m = /^\[(?:download|ExtractAudio|VideoConvertor)\].*Destination:\s+(.+)$/.exec(line)) || (m = /^\[Merger\] Merging formats into "(.+)"$/.exec(line))) {
        anyDownloaded = true; finals.set(stemOf(m[1]), m[1]);
        title = path.basename(m[1]).replace(/\.f\d+\.[A-Za-z0-9]+$/, '').replace(/\.[A-Za-z0-9]{2,5}$/, '');
      }
      else if (/has already been downloaded/.test(line)) anyDownloaded = true;
      else if (/^\[ExtractAudio\]/.test(line)) emit({ type: 'status', level: 'info', text: `${pfx}Conversione audio...` });
      else if (/^\[(Metadata|EmbedThumbnail|ThumbnailsConvertor)\]/.test(line)) emit({ type: 'status', level: 'info', text: `${pfx}Inserimento copertina e metadati...` });
      else if (/^\[(Merger|VideoConvertor|VideoRemuxer)\]/.test(line)) emit({ type: 'status', level: 'info', text: `${pfx}Elaborazione video (può richiedere tempo)...` });
      else if (/There are no subtitles for the requested languages/i.test(line)) noSubs = true;
      else if (/^ERROR:/.test(line)) lastErr = line.replace(/^ERROR:\s*/, '');
    });

    if (job.cancelled) break;
    if (res.error === 'ENOENT') return missing('yt-dlp');
    if (res.code === 0) ok++; else { errors++; if (!lastErr) lastErr = res.error || `yt-dlp ha terminato con codice ${res.code}`; }
  }
  ctx.writeLog('youtube', log);
  const s = summarize(job, ok, errors, lastErr, p.mode === 'subs' ? 'Download sottotitoli' : 'Download');
  if (s.status === 'error' && anyDownloaded) { s.status = 'warn'; }
  if (noSubs && s.status === 'ok') {
    s.status = 'warn';
    s.message = p.mode === 'subs' ? 'Nessun sottotitolo disponibile in questa lingua.' : s.message + ' Nota: non ci sono sottotitoli in questa lingua.';
  }
  s.outputs = [...finals.values()].filter((f) => fs.existsSync(f)).slice(-20);
  return s;
}

// ---------------------------------------------------------------- CONVERTITORE
async function runConvert(job, p, emit, ctx) {
  const fmt = Formats.byId(p.format);
  const files = (p.files || []).filter((f) => fs.existsSync(f));
  if (!fmt) return { status: 'error', message: 'Seleziona un formato di destinazione.' };
  if (!files.length) return { status: 'error', message: 'Seleziona prima i file da convertire.' };
  if (!ctx.bins.ffmpeg) return missing('ffmpeg');
  if (!ensureDir(p.outDir)) return { status: 'error', message: 'La cartella di output non esiste e non si riesce a crearla.' };

  const log = []; const outputs = []; let ok = 0, errors = 0, lastErr = '';

  for (let i = 0; i < files.length; i++) {
    if (job.cancelled) break;
    const inFile = files[i], name = path.parse(inFile).name;
    let out = path.join(p.outDir, `${name}.${fmt.ext}`);
    if (path.resolve(out).toLowerCase() === path.resolve(inFile).toLowerCase()) out = path.join(p.outDir, `${name}_convertito.${fmt.ext}`);
    out = uniquePath(out);

    // opzioni scelte dall'utente: compressione, rotazione, dimensione e qualita delle foto
    const args = ['-hide_banner', '-y', '-i', inFile, ...Formats.applyOptions(fmt, p), out];

    const pfx = files.length > 1 ? `[${i + 1}/${files.length}] ` : '';
    emit({ type: 'item', path: inFile, state: 'running' });
    emit({ type: 'status', level: 'info', text: `${pfx}Conversione: ${path.basename(inFile)}` });

    let total = 0;
    const res = await run(job, ctx.bins.ffmpeg, args, (line) => {
      log.push(line);
      let m;
      if (!total && (m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line))) total = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
      if ((m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line)) && total > 0) {
        const t = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        emit({ type: 'progress', value: (i + Math.min(t / total, 1)) / files.length, text: `${pfx}Conversione: ${path.basename(inFile)} · ${Math.floor(Math.min(t / total, 1) * 100)}%` });
      }
    });

    if (job.cancelled) { try { fs.rmSync(out, { force: true }); } catch (_) { /* ignora */ } emit({ type: 'item', path: inFile, state: 'cancelled' }); break; }
    if (res.error === 'ENOENT') return missing('ffmpeg');
    if (res.code === 0) { ok++; outputs.push(out); emit({ type: 'item', path: inFile, state: 'ok' }); }
    else { errors++; lastErr = log.filter((l) => !/^\s*(Stream|Metadata|Duration|frame=|size=)/.test(l)).slice(-1)[0] || `ffmpeg codice ${res.code}`; emit({ type: 'item', path: inFile, state: 'error' }); }
    emit({ type: 'progress', value: (i + 1) / files.length });
  }
  ctx.writeLog('convert', log);
  return { ...summarize(job, ok, errors, lastErr, 'Conversione'), outputs };
}

// ---------------------------------------------------------------- DRONE SYNC
async function runDrone(job, p, emit, ctx) {
  const files = (p.files || []).filter((f) => fs.existsSync(f));
  if (!files.length) return { status: 'error', message: 'Carica prima i file del drone.' };
  if (!ctx.bins.ffmpeg) return missing('ffmpeg');
  if (!ensureDir(p.outDir)) return { status: 'error', message: 'La cartella di output non esiste e non si riesce a crearla.' };

  const { pairs, noAudio, unmatched } = drone.pairFiles(files);
  noAudio.forEach((f) => emit({ type: 'item', path: f, state: 'noaudio' }));
  unmatched.forEach((f) => emit({ type: 'item', path: f, state: 'nomatch' }));
  if (!pairs.length) return { status: 'warn', message: 'Nessun video ha un audio con lo stesso nome: niente da sincronizzare.' };

  const log = []; const outputs = []; let ok = 0, errors = 0, lastErr = '';
  for (let i = 0; i < pairs.length; i++) {
    if (job.cancelled) break;
    const { video, audio } = pairs[i];
    const vp = path.parse(video);
    let out = path.join(p.outDir, vp.base);
    if (path.resolve(out).toLowerCase() === path.resolve(video).toLowerCase()) out = path.join(p.outDir, `${vp.name}_sync${vp.ext}`);
    out = uniquePath(out);

    const pfx = pairs.length > 1 ? `[${i + 1}/${pairs.length}] ` : '';
    emit({ type: 'item', path: video, state: 'running' }); emit({ type: 'item', path: audio, state: 'running' });
    emit({ type: 'status', level: 'info', text: `${pfx}Analisi durate: ${vp.base}` });

    const [vDur, aDur] = await Promise.all([drone.probeDuration(ctx.bins.ffmpeg, video), drone.probeDuration(ctx.bins.ffmpeg, audio)]);
    log.push(`${vp.base}: video=${vDur}s audio=${aDur}s`);
    let note = '';
    if (vDur && aDur && aDur < vDur) note = ` (audio più corto di ${(vDur - aDur).toFixed(1)}s: silenzio in coda, video completo)`;
    else if (vDur && aDur && aDur > vDur) note = ' (audio più lungo: tagliato alla durata del video)';
    emit({ type: 'status', level: 'info', text: `${pfx}Sincronizzazione: ${vp.base}${note}` });

    const args = drone.buildSyncArgs({ video, audio, out, vDur, aDur });
    let total = vDur || 0;
    const res = await run(job, ctx.bins.ffmpeg, args, (line) => {
      log.push(line);
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
      if (m && total > 0) { const t = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]); emit({ type: 'progress', value: (i + Math.min(t / total, 1)) / pairs.length }); }
    });

    if (job.cancelled) { try { fs.rmSync(out, { force: true }); } catch (_) { /* ignora */ } ['cancelled'].forEach((s) => { emit({ type: 'item', path: video, state: s }); emit({ type: 'item', path: audio, state: s }); }); break; }
    if (res.error === 'ENOENT') return missing('ffmpeg');
    const st = res.code === 0 ? 'ok' : 'error';
    if (res.code === 0) { ok++; outputs.push(out); } else { errors++; lastErr = log.slice(-1)[0] || `ffmpeg codice ${res.code}`; }
    emit({ type: 'item', path: video, state: st }); emit({ type: 'item', path: audio, state: st });
    emit({ type: 'progress', value: (i + 1) / pairs.length });
  }
  ctx.writeLog('drone', log);
  const s = summarize(job, ok, errors, lastErr, 'Sincronizzazione');
  if (s.status === 'ok') s.message = `Sincronizzazione completata! ${ok} video uniti.`;
  s.outputs = outputs;
  return s;
}


// ---------------------------------------------------------------- STRUMENTI A RICETTA
// La ricetta viene cercata per id fra quelle gia validate dal programma: dall'interfaccia arrivano solo id e valori.
async function runRecipe(job, p, emit, ctx) {
  const r = ctx.recipes && ctx.recipes.get(p.id);
  if (!r) return C.fail('Questo strumento non è più disponibile. Riavvia l\'app.');
  const prog = r.run.program, exe = prog === 'ffmpeg' ? ctx.bins.ffmpeg : ctx.bins.ytdlp;
  if (!exe) return missing(prog);
  if (!ensureDir(p.outDir)) return C.fail('La cartella di output non esiste e non si riesce a crearla.');
  const values = RC.sanitizeValues(r, p.values);

  let inputs;
  if (r.input.type === 'files') {
    const acc = (r.input.accept || []).map((x) => x.toLowerCase());
    inputs = (p.inputs || []).filter((f) => typeof f === 'string' && fs.existsSync(f) && (!acc.length || acc.includes(path.extname(f).slice(1).toLowerCase())));
    if (!inputs.length) return C.fail(acc.length ? `Aggiungi almeno un file (${acc.join(', ')}).` : 'Aggiungi almeno un file.');
  } else if (r.input.type === 'text') {
    inputs = (p.inputs || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 50);
    if (!inputs.length) return C.fail('Inserisci almeno un link o un testo.');
  } else inputs = [null];

  const log = [], outputs = []; let ok = 0, errors = 0, lastErr = '';
  for (let i = 0; i < inputs.length && !job.cancelled; i++) {
    const input = inputs[i], isFile = r.input.type === 'files';
    const name = isFile ? path.parse(input).name : `elemento${i + 1}`;
    let output;
    if (prog === 'ffmpeg') output = uniquePath(path.join(p.outDir, RC.outputName(r, values, name)));
    else output = path.join(p.outDir, RC.expand(r.run.output || '%(title)s.%(ext)s', { ...values, name }));
    let args = RC.buildArgs(r, values, { input: input == null ? '' : input, output, name, outdir: p.outDir });
    args = prog === 'ffmpeg'
      ? ['-hide_banner', '-nostdin', '-y', ...args]
      : ['--newline', ...(ctx.bins.ffmpegDir ? ['--ffmpeg-location', ctx.bins.ffmpegDir] : []), ...(ctx.bins.jsRuntime ? ['--js-runtimes', ctx.bins.jsRuntime] : []), ...args];

    const pfx = inputs.length > 1 ? `[${i + 1}/${inputs.length}] ` : '';
    if (isFile) emit({ type: 'item', path: input, state: 'running' });
    emit({ type: 'status', level: 'info', text: `${pfx}${r.name}${isFile ? ': ' + path.basename(input) : '…'}` });
    let total = 0;
    const res = await run(job, exe, args, (line) => {
      log.push(line); let m;
      if (prog === 'ffmpeg') {
        if (!total && (m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line))) total = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        if ((m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line)) && total > 0) {
          const f = Math.min(((+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3])) / total, 1);
          emit({ type: 'progress', value: (i + f) / inputs.length, text: `${pfx}${r.name} · ${Math.floor(f * 100)}%` });
        }
      } else if ((m = /^\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line))) {
        emit({ type: 'progress', value: (i + parseFloat(m[1]) / 100) / inputs.length, text: `${pfx}${r.name} · ${Math.floor(parseFloat(m[1]))}%` });
      } else if (/^ERROR:/.test(line)) lastErr = line.replace(/^ERROR:\s*/, '');
    });
    if (job.cancelled) { if (prog === 'ffmpeg') { try { fs.rmSync(output, { force: true }); } catch (_) { /* ok */ } } if (isFile) emit({ type: 'item', path: input, state: 'cancelled' }); break; }
    if (res.error === 'ENOENT') return missing(prog);
    if (res.code === 0) { ok++; if (prog === 'ffmpeg') outputs.push(output); if (isFile) emit({ type: 'item', path: input, state: 'ok' }); }
    else {
      errors++; if (prog === 'ffmpeg') { try { fs.rmSync(output, { force: true }); } catch (_) { /* ok */ } }
      if (!lastErr) lastErr = log.filter((l) => /(error|invalid|no such|unknown|not found|failed|unrecognized|cannot|unable)/i.test(l)).slice(-1)[0] || `${prog} ha terminato con codice ${res.code}`;
      if (isFile) emit({ type: 'item', path: input, state: 'error' });
    }
    emit({ type: 'progress', value: (i + 1) / inputs.length });
  }
  ctx.writeLog('recipe-' + r.id, log);
  const s = summarize(job, ok, errors, lastErr, r.name);
  s.outputs = outputs; return s;
}

module.exports = { youtube: runYoutube, convert: runConvert, drone: runDrone, recipe: runRecipe };
