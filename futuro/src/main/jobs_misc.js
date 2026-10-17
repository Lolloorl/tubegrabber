'use strict';
// Flussi: foto in blocco, tag audio, strumenti drone (stabilizza, time-lapse).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const C = require('./common');
const media = require('./media');
const { ffmpeg, lastError } = require('./ffrun');

const rm = (f) => { try { fs.rmSync(f, { force: true }); } catch (_) { /* ok */ } };

// ---------------------------------------------------------------- FOTO IN BLOCCO
async function runPhotos(job, p, emit, ctx) {
  const files = (p.files || []).filter((f) => fs.existsSync(f));
  if (!files.length) return C.fail('Aggiungi prima le foto.');
  const pre = C.checkFfmpegOut(ctx, p); if (pre) return pre;
  const maxSide = Math.max(0, Number(p.maxSide) || 0), q = Math.min(100, Math.max(30, Number(p.quality) || 85));
  const fmt = ['same', 'jpg', 'png', 'webp'].includes(p.format) ? p.format : 'same';

  const log = [], outputs = []; let ok = 0, errors = 0, lastErr = '', done = 0, inBytes = 0, outBytes = 0;
  await C.pool(files, 3, async (f) => {
    if (job.cancelled) return;
    const { name, ext } = path.parse(f);
    let e = fmt === 'same' ? ext.replace('.', '').toLowerCase() : fmt;
    if (e === 'jpeg') e = 'jpg';
    if (!['jpg', 'png', 'webp', 'bmp', 'tif', 'tiff'].includes(e)) e = 'jpg';
    let out = path.join(p.outDir, `${name}.${e}`);
    if (path.resolve(out).toLowerCase() === path.resolve(f).toLowerCase()) out = path.join(p.outDir, `${name}_ridotta.${e}`);
    out = C.uniquePath(out);
    const args = ['-hide_banner', '-y', '-i', f];
    if (maxSide) args.push('-vf', `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`);
    if (e === 'jpg') args.push('-q:v', String(Math.round(2 + (100 - q) / 100 * 29)));
    else if (e === 'webp') args.push('-q:v', String(q));
    args.push('-frames:v', '1', '-update', '1', out);
    const lines = [];
    const r = await ffmpeg(job, ctx.bins.ffmpeg, args, { log: lines });
    log.push(...lines.slice(-5));
    if (r.error === 'ENOENT') { errors++; lastErr = 'ffmpeg non trovato'; }
    else if (r.code === 0 && fs.existsSync(out)) { ok++; outputs.push(out); inBytes += fs.statSync(f).size; outBytes += fs.statSync(out).size; emit({ type: 'item', path: f, state: 'ok' }); }
    else { errors++; lastErr = `${path.basename(f)}: ${lastError(lines) || 'conversione non riuscita'}`; emit({ type: 'item', path: f, state: 'error' }); }
    done++; emit({ type: 'progress', value: done / files.length, text: `Foto ${done}/${files.length}` });
  });
  ctx.writeLog('photos', log);
  const s = C.summarize(job, ok, errors, lastErr, 'Elaborazione foto');
  if (s.status === 'ok') s.message = `${ok} foto pronte: da ${C.fmtSize(inBytes)} a ${C.fmtSize(outBytes)}`;
  s.outputs = outputs.slice(0, 20); return s;
}

// ---------------------------------------------------------------- TAG AUDIO
const COVER_OK = /\.(mp3|m4a|flac)$/i;
async function runTags(job, p, emit, ctx) {
  const items = (p.files || []).filter((x) => x && fs.existsSync(x.path));
  if (!items.length) return C.fail('Aggiungi prima i brani da modificare.');
  const pre = p.inPlace ? (ctx.bins.ffmpeg ? null : C.missing('ffmpeg')) : C.checkFfmpegOut(ctx, p); if (pre) return pre;
  const cover = p.cover && fs.existsSync(p.cover) ? p.cover : null;
  const common = {}; for (const k of ['artist', 'album', 'year', 'genre']) if (p.common && String(p.common[k] || '').trim()) common[k] = String(p.common[k]).trim();

  const log = [], outputs = []; let ok = 0, errors = 0, lastErr = '';
  for (let i = 0; i < items.length && !job.cancelled; i++) {
    const it = { ...items[i], ...common }, f = it.path, { dir, name, ext, base } = path.parse(f);
    emit({ type: 'item', path: f, state: 'running' });
    const useCover = cover && COVER_OK.test(f);
    const target = p.inPlace ? path.join(dir, `${name}.tg-tmp${ext}`) : C.uniquePath(path.join(p.outDir, base));
    const meta = [];
    for (const [k, v] of [['title', it.title], ['artist', it.artist], ['album', it.album], ['track', it.track], ['date', it.year], ['genre', it.genre]]) meta.push('-metadata', `${k}=${v == null ? '' : v}`);
    const args = ['-hide_banner', '-y', '-i', f];
    if (useCover) args.push('-i', cover, '-map', '0:a', '-map', '1:v', '-c', 'copy', '-disposition:v:0', 'attached_pic', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
    else args.push('-map', '0', '-c', 'copy');
    args.push('-map_metadata', '0', ...meta);
    if (/\.mp3$/i.test(f)) args.push('-id3v2_version', '3');
    args.push(target);
    const lines = [];
    const r = await ffmpeg(job, ctx.bins.ffmpeg, args, { log: lines }); log.push(...lines.slice(-4));
    if (r.error === 'ENOENT') return C.missing('ffmpeg');
    if (r.code === 0 && fs.existsSync(target)) {
      let final = target;
      if (p.inPlace) { try { fs.renameSync(target, f); final = f; } catch (e) { rm(target); errors++; lastErr = `${base}: impossibile sostituire il file (è in uso?)`; emit({ type: 'item', path: f, state: 'error' }); continue; } }
      ok++; outputs.push(final); emit({ type: 'item', path: f, state: 'ok' });
    } else { rm(target); errors++; lastErr = `${base}: ${lastError(lines) || 'scrittura tag non riuscita'}`; emit({ type: 'item', path: f, state: 'error' }); }
    emit({ type: 'progress', value: (i + 1) / items.length, text: `Brano ${i + 1}/${items.length}` });
  }
  ctx.writeLog('tags', log);
  const s = C.summarize(job, ok, errors, lastErr, 'Salvataggio tag');
  if (s.status === 'ok' && cover && items.some((x) => !COVER_OK.test(x.path))) { s.status = 'warn'; s.message = 'Tag salvati. La copertina non è supportata da OGG/OPUS e per quei file è stata saltata.'; }
  s.outputs = outputs.slice(0, 20); return s;
}

// ---------------------------------------------------------------- DRONE: STABILIZZA
function hasFilter(ffmpegBin, name) {
  return new Promise((resolve) => execFile(ffmpegBin, ['-hide_banner', '-filters'], { timeout: 20000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    (e, out) => resolve(new RegExp('\\b' + name + '\\b').test(String(out || '')))));
}
const SMOOTH = { light: 8, normal: 15, strong: 30 };

async function runStabilize(job, p, emit, ctx) {
  const files = (p.files || []).filter((f) => fs.existsSync(f));
  if (!files.length) return C.fail('Aggiungi prima i video da stabilizzare.');
  const pre = C.checkFfmpegOut(ctx, p); if (pre) return pre;
  const vidstab = await hasFilter(ctx.bins.ffmpeg, 'vidstabdetect');
  const smooth = SMOOTH[p.strength] || SMOOTH.normal;
  const log = [], outputs = []; let ok = 0, errors = 0, lastErr = '';
  if (!vidstab) emit({ type: 'status', level: 'warn', text: 'Questo ffmpeg non ha la stabilizzazione avanzata: uso il metodo base.' });

  for (let i = 0; i < files.length && !job.cancelled; i++) {
    const f = files[i], { name } = path.parse(f), base = path.basename(f);
    emit({ type: 'item', path: f, state: 'running' });
    const info = await media.probe(ctx.bins.ffmpeg, f);
    if (!info.hasVideo) { errors++; lastErr = `${base}: non è un video`; emit({ type: 'item', path: f, state: 'error' }); continue; }
    const out = C.uniquePath(path.join(p.outDir, `${name}_stabilizzato.mp4`));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg_stab_'));
    const dur = info.duration || 0, pfx = files.length > 1 ? `[${i + 1}/${files.length}] ` : '';
    const prog = (off, span) => (v) => emit({ type: 'progress', value: (i + off + v * span) / files.length, text: `${pfx}${off ? 'Stabilizzazione' : 'Analisi'}: ${base} · ${Math.floor((off + v * span) * 100)}%` });
    const enc = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out];
    let r;
    if (vidstab) {
      // il file dei movimenti e' relativo alla cartella temporanea (evita i problemi di ":" nei percorsi Windows)
      const r1 = await ffmpeg(job, ctx.bins.ffmpeg, ['-hide_banner', '-y', '-i', f, '-vf', 'vidstabdetect=shakiness=6:accuracy=15:result=motion.trf', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'],
        { total: dur, log, onProgress: prog(0, 0.4), cwd: tmp });
      r = r1.code === 0 && !job.cancelled
        ? await ffmpeg(job, ctx.bins.ffmpeg, ['-hide_banner', '-y', '-i', f, '-vf', `vidstabtransform=input=motion.trf:smoothing=${smooth}:optzoom=1,unsharp=5:5:0.8:3:3:0.4`, ...enc],
          { total: dur, log, onProgress: prog(0.4, 0.6), cwd: tmp })
        : r1;
    } else {
      r = await ffmpeg(job, ctx.bins.ffmpeg, ['-hide_banner', '-y', '-i', f, '-vf', 'deshake', ...enc], { total: dur, log, onProgress: prog(0, 1), cwd: tmp });
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ok */ }
    if (job.cancelled) { rm(out); emit({ type: 'item', path: f, state: 'cancelled' }); break; }
    if (r.error === 'ENOENT') return C.missing('ffmpeg');
    if (r.code === 0) { ok++; outputs.push(out); emit({ type: 'item', path: f, state: 'ok' }); }
    else { errors++; rm(out); lastErr = `${base}: ${lastError(log) || 'stabilizzazione non riuscita'}`; emit({ type: 'item', path: f, state: 'error' }); }
  }
  ctx.writeLog('stabilize', log);
  const s = C.summarize(job, ok, errors, lastErr, 'Stabilizzazione'); s.outputs = outputs; return s;
}

// ---------------------------------------------------------------- DRONE: TIME-LAPSE
const SIZES = { '720p': [1280, 720], '1080p': [1920, 1080], '4k': [3840, 2160] };
async function runTimelapse(job, p, emit, ctx) {
  const images = C.natSort((p.files || []).filter((f) => fs.existsSync(f)));
  if (images.length < 2) return C.fail('Servono almeno due foto per un time-lapse.');
  const pre = C.checkFfmpegOut(ctx, p); if (pre) return pre;
  const fps = [12, 24, 25, 30, 60].includes(Number(p.fps)) ? Number(p.fps) : 30;
  let W, H;
  if (SIZES[p.size]) [W, H] = SIZES[p.size];
  else { const i = await media.probe(ctx.bins.ffmpeg, images[0]); W = (i.width || 1920); H = (i.height || 1080); W -= W % 2; H -= H % 2; }

  const frameDur = (1 / fps).toFixed(6);
  const lines = [];
  images.forEach((f) => { lines.push(`file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`, `duration ${frameDur}`); });
  lines.push(`file '${images[images.length - 1].replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);   // l'ultimo fotogramma va ripetuto
  const list = path.join(os.tmpdir(), `tg_tl_${C.stamp()}.txt`); fs.writeFileSync(list, lines.join('\n'));
  const out = C.uniquePath(path.join(p.outDir, `Timelapse_${C.stamp()}.mp4`));
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
  const log = [], total = images.length / fps;
  emit({ type: 'status', level: 'info', text: `Creazione time-lapse da ${images.length} foto…` });
  const r = await ffmpeg(job, ctx.bins.ffmpeg, ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', vf, '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart', out],
    { total, log, onProgress: (v) => emit({ type: 'progress', value: v, text: `Time-lapse · ${Math.floor(v * 100)}%` }) });
  rm(list); ctx.writeLog('timelapse', log);
  if (job.cancelled) { rm(out); return { status: 'cancelled', message: 'Time-lapse annullato.' }; }
  if (r.error === 'ENOENT') return C.missing('ffmpeg');
  if (r.code !== 0) { rm(out); return C.fail(C.clip(lastError(log) || 'time-lapse non riuscito')); }
  return { status: 'ok', message: `Time-lapse pronto: ${images.length} foto → ${total.toFixed(1)} s (${W}×${H})`, outputs: [out] };
}

async function runDroneTools(job, p, emit, ctx) {
  return p.mode === 'timelapse' ? runTimelapse(job, p, emit, ctx) : runStabilize(job, p, emit, ctx);
}

module.exports = { photos: runPhotos, tags: runTags, dronetools: runDroneTools, hasFilter };
