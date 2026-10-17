'use strict';
// Flussi: comprimi (dimensione massima), taglia, unisci, GIF.
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('./common');
const media = require('./media');
const { ffmpeg, lastError } = require('./ffrun');

const NULL_OUT = process.platform === 'win32' ? 'NUL' : '/dev/null';
const even = (e) => `trunc(min(${e})/2)*2`;

// ---------------------------------------------------------------- COMPRIMI
async function runCompress(job, p, emit, ctx) {
  const files = (p.files || []).filter((f) => fs.existsSync(f));
  const target = Number(p.targetMB);
  if (!files.length) return C.fail('Aggiungi prima i video da comprimere.');
  if (!(target >= 1)) return C.fail('Indica la dimensione massima in MB.');
  const pre = C.checkFfmpegOut(ctx, p); if (pre) return pre;

  const log = [], outputs = []; let ok = 0, errors = 0, lastErr = '', last = '';
  for (let i = 0; i < files.length && !job.cancelled; i++) {
    const f = files[i], { name } = path.parse(f), base = path.basename(f);
    emit({ type: 'item', path: f, state: 'running' });
    const info = await media.probe(ctx.bins.ffmpeg, f);
    if (!info.hasVideo || !info.duration) { errors++; lastErr = `${base}: non è un video leggibile`; emit({ type: 'item', path: f, state: 'error' }); continue; }
    if (fs.statSync(f).size <= target * 1024 * 1024 * 0.98) { ok++; emit({ type: 'item', path: f, state: 'skip' }); continue; }
    const plan = media.planCompression({ duration: info.duration, targetMB: target, hasAudio: info.hasAudio, height: info.height, fps: info.fps });
    if (plan.error) { errors++; lastErr = plan.error; emit({ type: 'item', path: f, state: 'error' }); continue; }

    const out = C.uniquePath(path.join(p.outDir, `${name}_${target}MB.mp4`));
    const passlog = path.join(os.tmpdir(), `tg_pass_${C.stamp()}_${i}`);
    const vf = `scale=-2:'${even(`${plan.maxHeight},ih`)}'${plan.capFps ? ',fps=30' : ''}`;
    const common = ['-hide_banner', '-y', '-i', f, '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${plan.videoKbps}k`,
      '-maxrate', `${Math.round(plan.videoKbps * 1.5)}k`, '-bufsize', `${plan.videoKbps * 2}k`, '-pix_fmt', 'yuv420p', '-passlogfile', passlog];
    const prog = (off) => (v) => emit({ type: 'progress', value: (i + off + v * 0.5) / files.length, text: `${files.length > 1 ? `[${i + 1}/${files.length}] ` : ''}${off ? 'Compressione' : 'Analisi'}: ${base} · ${Math.floor((off + v * 0.5) * 100)}%` });

    const r1 = await ffmpeg(job, ctx.bins.ffmpeg, [...common, '-pass', '1', '-an', '-f', 'null', NULL_OUT], { total: info.duration, log, onProgress: prog(0) });
    let r2 = { code: -1 };
    if (!job.cancelled && r1.code === 0) {
      r2 = await ffmpeg(job, ctx.bins.ffmpeg, [...common, '-pass', '2', ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', `${plan.audioKbps}k`] : ['-an']), '-movflags', '+faststart', out], { total: info.duration, log, onProgress: prog(0.5) });
    }
    for (const x of ['-0.log', '-0.log.mbtree', '.log', '.log.mbtree']) { try { fs.rmSync(passlog + x, { force: true }); } catch (_) { /* ok */ } }
    if (job.cancelled) { try { fs.rmSync(out, { force: true }); } catch (_) { /* ok */ } emit({ type: 'item', path: f, state: 'cancelled' }); break; }
    if (r1.error === 'ENOENT') return C.missing('ffmpeg');
    if (r2.code === 0 && fs.existsSync(out)) {
      const size = fs.statSync(out).size; ok++; outputs.push(out); last = `${base} → ${C.fmtSize(size)}`;
      emit({ type: 'item', path: f, state: size > target * 1024 * 1024 ? 'warn' : 'ok' });
      if (size > target * 1024 * 1024) { lastErr = `${base}: ${C.fmtSize(size)} supera di poco il limite`; errors++; ok--; }
    } else { errors++; lastErr = lastError(log) || 'compressione non riuscita'; emit({ type: 'item', path: f, state: 'error' }); }
    emit({ type: 'progress', value: (i + 1) / files.length });
  }
  ctx.writeLog('compress', log);
  const s = C.summarize(job, ok, errors, lastErr, 'Compressione');
  if (s.status === 'ok') s.message = files.length === 1 && last ? `Fatto: ${last}` : `Compressione completata: ${ok} video.`;
  s.outputs = outputs; return s;
}

// ---------------------------------------------------------------- TAGLIA
async function runTrim(job, p, emit, ctx) {
  if (!p.file || !fs.existsSync(p.file)) return C.fail('Scegli prima un file da tagliare.');
  const pre = C.checkFfmpegOut(ctx, p); if (pre) return pre;
  const info = await media.probe(ctx.bins.ffmpeg, p.file);
  const dur = info.duration || 0;
  const start = Math.max(0, Number(p.start) || 0);
  let end = Number(p.end) > 0 ? Number(p.end) : dur;
  if (dur && end > dur) end = dur;
  if (!(end - start >= 0.1)) return C.fail('La fine deve essere dopo l\'inizio.');

  const { name, ext } = path.parse(p.file);
  const precise = p.mode === 'precise' && info.hasVideo;
  const outExt = precise && !/^\.(mp4|mov|mkv)$/i.test(ext) ? '.mp4' : ext;
  const out = C.uniquePath(path.join(p.outDir, `${name}_taglio${outExt}`));
  const args = ['-hide_banner', '-y', '-ss', String(start), '-i', p.file, '-t', String(end - start)];
  if (precise) args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k');
  else args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
  if (/\.(mp4|mov|m4v)$/i.test(outExt)) args.push('-movflags', '+faststart');
  args.push(out);

  const log = [];
  emit({ type: 'status', level: 'info', text: `Taglio: ${path.basename(p.file)}` });
  const r = await ffmpeg(job, ctx.bins.ffmpeg, args, { total: end - start, log, onProgress: (v) => emit({ type: 'progress', value: v, text: `Taglio · ${Math.floor(v * 100)}%` }) });
  ctx.writeLog('trim', log);
  if (job.cancelled) { try { fs.rmSync(out, { force: true }); } catch (_) { /* ok */ } return { status: 'cancelled', message: 'Taglio annullato.' }; }
  if (r.error === 'ENOENT') return C.missing('ffmpeg');
  if (r.code !== 0) return C.fail(C.clip(lastError(log) || 'taglio non riuscito'));
  return { status: 'ok', message: `Fatto: ${path.basename(out)} (${C.fmtSize(fs.statSync(out).size)})`, outputs: [out] };
}

// ---------------------------------------------------------------- UNISCI
const esc = (f) => f.replace(/\\/g, '/').replace(/'/g, "'\\''");
function writeList(lines) {
  const f = path.join(os.tmpdir(), `tg_list_${C.stamp()}_${Math.random().toString(36).slice(2, 6)}.txt`);
  fs.writeFileSync(f, lines.join('\n'));
  return f;
}

function buildMergeFilter(infos, W, H, fps) {
  const parts = [];
  infos.forEach((n, i) => {
    parts.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`);
    parts.push(n.hasAudio
      ? `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${n.duration.toFixed(3)}[a${i}]`);
  });
  parts.push(infos.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${infos.length}:v=1:a=1[v][a]`);
  return parts.join(';');
}

async function runMerge(job, p, emit, ctx) {
  const files = (p.files || []).filter((f) => fs.existsSync(f));
  if (files.length < 2) return C.fail('Servono almeno due video da unire.');
  const pre = C.checkFfmpegOut(ctx, p); if (pre) return pre;

  emit({ type: 'status', level: 'info', text: 'Analisi dei video…' });
  const infos = [];
  for (const f of files) {
    const n = await media.probe(ctx.bins.ffmpeg, f);
    if (!n.hasVideo || !n.duration) return C.fail(`${path.basename(f)} non è un video leggibile.`);
    infos.push(n);
  }
  const total = infos.reduce((a, n) => a + n.duration, 0);
  const out = C.uniquePath(path.join(p.outDir, `${path.parse(files[0]).name}_unione.mp4`));
  const log = [], prog = (v) => emit({ type: 'progress', value: v, text: `Unione · ${Math.floor(v * 100)}%` });
  let r = { code: -1 };

  if (p.mode !== 'safe') {   // veloce: nessuna ricodifica (clip con le stesse impostazioni, es. stesso drone)
    emit({ type: 'status', level: 'info', text: 'Unione veloce…' });
    const list = writeList(files.map((f) => `file '${esc(f)}'`));
    r = await ffmpeg(job, ctx.bins.ffmpeg, ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { total, log, onProgress: prog });
    try { fs.rmSync(list, { force: true }); } catch (_) { /* ok */ }
    if (r.code !== 0 && !job.cancelled) { emit({ type: 'status', level: 'warn', text: 'Clip diverse tra loro: passo alla ricodifica…' }); try { fs.rmSync(out, { force: true }); } catch (_) { /* ok */ } }
  }
  if (r.code !== 0 && !job.cancelled) {
    const W = (infos[0].width || 1280) - ((infos[0].width || 1280) % 2), H = (infos[0].height || 720) - ((infos[0].height || 720) % 2);
    const fps = Math.min(60, Math.round(infos[0].fps) || 30);
    const args = ['-hide_banner', '-y'];
    files.forEach((f) => args.push('-i', f));
    args.push('-filter_complex', buildMergeFilter(infos, W, H, fps), '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out);
    log.length = 0;
    r = await ffmpeg(job, ctx.bins.ffmpeg, args, { total, log, onProgress: prog });
  }
  ctx.writeLog('merge', log);
  if (job.cancelled) { try { fs.rmSync(out, { force: true }); } catch (_) { /* ok */ } return { status: 'cancelled', message: 'Unione annullata.' }; }
  if (r.error === 'ENOENT') return C.missing('ffmpeg');
  if (r.code !== 0) return C.fail(C.clip(lastError(log) || 'unione non riuscita'));
  return { status: 'ok', message: `Fatto: ${files.length} video uniti in ${path.basename(out)} (${C.fmtSize(fs.statSync(out).size)})`, outputs: [out] };
}

// ---------------------------------------------------------------- GIF
async function runGif(job, p, emit, ctx) {
  if (!p.file || !fs.existsSync(p.file)) return C.fail('Scegli prima un video.');
  const pre = C.checkFfmpegOut(ctx, p); if (pre) return pre;
  const info = await media.probe(ctx.bins.ffmpeg, p.file);
  if (!info.hasVideo) return C.fail('Il file scelto non contiene video.');
  const start = Math.max(0, Number(p.start) || 0);
  let end = Number(p.end) > 0 ? Number(p.end) : (info.duration || start + 5);
  if (info.duration && end > info.duration) end = info.duration;
  if (!(end - start >= 0.2)) return C.fail('Scegli un tratto di almeno 0,2 secondi.');
  if (end - start > 60) return C.fail('Una GIF può durare al massimo 60 secondi: accorcia il tratto.');
  const fps = Math.min(30, Math.max(5, Number(p.fps) || 12)), width = Math.min(1280, Math.max(120, Number(p.width) || 480));

  const out = C.uniquePath(path.join(p.outDir, `${path.parse(p.file).name}.gif`));
  const vf = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`;
  const log = [];
  emit({ type: 'status', level: 'info', text: 'Creazione GIF…' });
  const r = await ffmpeg(job, ctx.bins.ffmpeg, ['-hide_banner', '-y', '-ss', String(start), '-t', String(end - start), '-i', p.file, '-vf', vf, '-loop', '0', out],
    { total: end - start, log, onProgress: (v) => emit({ type: 'progress', value: v, text: `GIF · ${Math.floor(v * 100)}%` }) });
  ctx.writeLog('gif', log);
  if (job.cancelled) { try { fs.rmSync(out, { force: true }); } catch (_) { /* ok */ } return { status: 'cancelled', message: 'GIF annullata.' }; }
  if (r.error === 'ENOENT') return C.missing('ffmpeg');
  if (r.code !== 0) return C.fail(C.clip(lastError(log) || 'creazione GIF non riuscita'));
  const size = fs.statSync(out).size;
  return { status: size > 20e6 ? 'warn' : 'ok', message: `GIF pronta: ${C.fmtSize(size)}${size > 20e6 ? ' (molto pesante: prova meno secondi o una larghezza minore)' : ''}`, outputs: [out] };
}

module.exports = { compress: runCompress, trim: runTrim, merge: runMerge, gif: runGif, buildMergeFilter };
