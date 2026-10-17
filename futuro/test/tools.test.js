const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const media = require('../src/main/media');
const yt = require('../src/main/youtube');
const jobs = require('../src/main/jobs');
const { readTags } = require('../src/main/tags');
const { updateYtdlp, parseSums } = require('../src/main/ytdlp-update');
const { createHistory } = require('../src/main/history');

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg2-'));
const mkJob = () => ({ cancelled: false, procs: new Set() });
const ctx = { bins: { ffmpeg: 'ffmpeg' }, writeLog() {} };
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: 'ignore' });
const P = (...a) => path.join(tmp, ...a);
const info = (f) => media.probe('ffmpeg', f);
const run = (name, p) => jobs[name](mkJob(), p, () => {}, ctx);
const opt = { skip: !hasFfmpeg };

// sorgenti condivise
const SRC = {};
test('prepara sorgenti', opt, () => {
  fs.mkdirSync(P('src'), { recursive: true });
  SRC.big = P('src', 'big.mp4');      // video "pesante" 20 s con rumore e audio
  ff('-f', 'lavfi', '-i', 'testsrc2=duration=20:size=1280x720:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=20', '-vf', 'noise=alls=30:allf=t', '-c:v', 'libx264', '-b:v', '3M', '-g', '25', '-c:a', 'aac', SRC.big);   // un fotogramma chiave al secondo, come i video reali
  SRC.a = P('src', 'a.mp4'); SRC.b = P('src', 'b.mp4'); SRC.c = P('src', 'c_noaudio_small.mp4');
  ff('-f', 'lavfi', '-i', 'testsrc=duration=3:size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', SRC.a);
  ff('-f', 'lavfi', '-i', 'testsrc2=duration=2:size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=800:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', SRC.b);
  ff('-f', 'lavfi', '-i', 'smptebars=duration=2:size=320x240:rate=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', SRC.c);
  assert.ok(fs.statSync(SRC.big).size > 4e6, 'sorgente abbastanza grande');
});

test('media.parseInfo e planCompression', opt, async () => {
  const i = await info(SRC.big);
  assert.ok(i.hasVideo && i.hasAudio && i.width === 1280 && i.height === 720 && Math.abs(i.duration - 20) < 0.3 && i.fps === 25);
  const plan = media.planCompression({ duration: 60, targetMB: 16, hasAudio: true, height: 1080, fps: 30 });
  assert.ok(plan.videoKbps > 1500 && plan.maxHeight === 720 && plan.audioKbps === 128);
  assert.ok(media.planCompression({ duration: 7200, targetMB: 8, hasAudio: true, height: 1080, fps: 30 }).error);
  assert.deepStrictEqual(media.parseFFMetadata(';FFMETADATA1\ntitle=A\\=B\nartist=X').title, 'A=B');
});

test('comprimi: rispetta la dimensione massima (2 passate)', opt, async () => {
  const target = 3;
  const r = await run('compress', { files: [SRC.big], targetMB: target, outDir: P('out_c') });
  assert.ok(r.status === 'ok', r.message);
  const size = fs.statSync(r.outputs[0]).size;
  assert.ok(size <= target * 1024 * 1024 && size > 1.2 * 1024 * 1024, `dimensione ${size}`);
  const i = await info(r.outputs[0]); assert.ok(Math.abs(i.duration - 20) < 0.5 && i.hasAudio);
  // file gia piccolo: saltato senza ricodifica
  const s = await run('compress', { files: [SRC.a], targetMB: 50, outDir: P('out_c') });
  assert.strictEqual(s.status, 'ok'); assert.strictEqual(s.outputs.length, 0);
});

test('taglia: veloce e preciso', opt, async () => {
  const f = await run('trim', { file: SRC.big, start: 5, end: 9, mode: 'fast', outDir: P('out_t') });
  assert.strictEqual(f.status, 'ok', f.message);
  const fi = await info(f.outputs[0]); assert.ok(fi.duration >= 3.9 && fi.duration < 5.2, 'veloce ' + fi.duration);   // puo partire fino a 1 keyframe prima
  const p = await run('trim', { file: SRC.big, start: 5, end: 9, mode: 'precise', outDir: P('out_t') });
  const pi = await info(p.outputs[0]); assert.ok(Math.abs(pi.duration - 4) < 0.2, 'preciso ' + pi.duration);
  assert.strictEqual((await run('trim', { file: SRC.big, start: 9, end: 5, outDir: P('out_t') })).status, 'error');
});

test('unisci: veloce, fallback e clip senza audio', opt, async () => {
  const fast = await run('merge', { files: [SRC.a, SRC.b], mode: 'fast', outDir: P('out_m') });
  assert.strictEqual(fast.status, 'ok', fast.message);
  assert.ok(Math.abs((await info(fast.outputs[0])).duration - 5) < 0.4);
  // risoluzioni diverse + clip senza audio -> ricodifica automatica con silenzio
  const mixed = await run('merge', { files: [SRC.a, SRC.c, SRC.b], mode: 'fast', outDir: P('out_m') });
  assert.strictEqual(mixed.status, 'ok', mixed.message);
  const mi = await info(mixed.outputs[0]);
  assert.ok(Math.abs(mi.duration - 7) < 0.5 && mi.hasAudio && mi.width === 640, `dur ${mi.duration} w ${mi.width}`);
  assert.strictEqual((await run('merge', { files: [SRC.a], outDir: P('out_m') })).status, 'error');
});

test('GIF', opt, async () => {
  const r = await run('gif', { file: SRC.big, start: 2, end: 5, fps: 10, width: 320, outDir: P('out_g') });
  assert.ok(r.status === 'ok' || r.status === 'warn', r.message);
  assert.strictEqual(fs.readFileSync(r.outputs[0]).slice(0, 3).toString(), 'GIF');
  const long = P('src', 'long.mp4'); ff('-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1:d=70', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', long);
  const tooLong = await run('gif', { file: long, start: 0, end: 70, outDir: P('out_g') });
  assert.strictEqual(tooLong.status, 'error'); assert.ok(/60 secondi/.test(tooLong.message));
  const clamp = await run('gif', { file: SRC.a, start: 1, end: 999, fps: 8, width: 200, outDir: P('out_g') });
  assert.ok(clamp.status === 'ok' && clamp.outputs.length === 1, 'fine oltre la durata: limitata, non rifiutata');
});

test('foto in blocco: ridimensiona e converte', opt, async () => {
  const d = P('photos'); fs.mkdirSync(d);
  const ph = [];
  for (let i = 1; i <= 4; i++) { const f = path.join(d, `img${i}.jpg`); ff('-f', 'lavfi', '-i', `testsrc2=size=2000x1500:rate=1:duration=1`, '-frames:v', '1', '-update', '1', f); ph.push(f); }
  const png = path.join(d, 'vert.png'); ff('-f', 'lavfi', '-i', 'testsrc=size=900x1600:rate=1:duration=1', '-frames:v', '1', '-update', '1', png);
  const r = await run('photos', { files: [...ph, png], maxSide: 800, quality: 80, format: 'webp', outDir: P('out_p') });
  assert.strictEqual(r.status, 'ok', r.message); assert.strictEqual(r.outputs.length, 5);
  const wide = await info(r.outputs.find((x) => /img1/.test(x))); assert.ok(wide.width === 800 && wide.height === 600, `${wide.width}x${wide.height}`);
  const tall = await info(r.outputs.find((x) => /vert/.test(x))); assert.ok(tall.height === 800 && tall.width === 450, `${tall.width}x${tall.height}`);
  const jp = await run('photos', { files: [png], maxSide: 0, format: 'jpg', quality: 90, outDir: P('out_p2') });
  assert.ok(jp.outputs[0].endsWith('.jpg'));
});

test('tag audio: legge, scrive, copertina, in-place', opt, async () => {
  const mp3 = P('src', 'brano.mp3'), cov = P('src', 'cover.png');
  ff('-f', 'lavfi', '-i', 'sine=duration=3', '-metadata', 'title=Vecchio', '-metadata', 'artist=Tizio', mp3);
  ff('-f', 'lavfi', '-i', 'testsrc=size=300x300:rate=1:duration=1', '-frames:v', '1', '-update', '1', cov);
  let t = await readTags('ffmpeg', mp3); assert.strictEqual(t.title, 'Vecchio'); assert.strictEqual(t.artist, 'Tizio'); assert.ok(!t.hasCover);
  const r = await run('tags', { files: [{ ...t, title: 'Nuovo; titolo = test', track: '3' }], common: { album: 'Album X', year: '2026', genre: 'Rock' }, cover: cov, outDir: P('out_tag') });
  assert.strictEqual(r.status, 'ok', r.message);
  t = await readTags('ffmpeg', r.outputs[0]);
  assert.strictEqual(t.title, 'Nuovo; titolo = test'); assert.strictEqual(t.album, 'Album X'); assert.strictEqual(t.year, '2026'); assert.strictEqual(t.track, '3'); assert.ok(t.hasCover);
  // in place: il file originale viene sostituito, nessun temporaneo resta
  const copy = P('src', 'inplace.mp3'); fs.copyFileSync(mp3, copy);
  const ip = await run('tags', { files: [{ path: copy, title: 'Cambiato', artist: '', album: '', track: '', year: '', genre: '' }], inPlace: true, outDir: P('x') });
  assert.strictEqual(ip.status, 'ok', ip.message);
  assert.strictEqual((await readTags('ffmpeg', copy)).title, 'Cambiato');
  assert.ok(!fs.readdirSync(P('src')).some((n) => n.includes('tg-tmp')));
});

test('drone: stabilizzazione e time-lapse (ordine naturale)', opt, async () => {
  const s = await run('dronetools', { mode: 'stabilize', files: [SRC.a], strength: 'normal', outDir: P('out_s') });
  assert.strictEqual(s.status, 'ok', s.message);
  assert.ok(Math.abs((await info(s.outputs[0])).duration - 3) < 0.4);
  const d = P('tl'); fs.mkdirSync(d); const imgs = [];
  for (const n of [1, 2, 10, 3, 11, 4, 5, 6, 7, 8]) { const f = path.join(d, `IMG_${n}.jpg`); ff('-f', 'lavfi', '-i', `color=c=0x${(n * 20).toString(16).padStart(2, '0')}8040:size=640x480:rate=1:duration=1`, '-frames:v', '1', '-update', '1', f); imgs.push(f); }
  const t = await run('dronetools', { mode: 'timelapse', files: imgs, fps: 24, size: '720p', outDir: P('out_tl') });
  assert.strictEqual(t.status, 'ok', t.message);
  const ti = await info(t.outputs[0]);
  assert.ok(ti.width === 1280 && ti.height === 720 && Math.abs(ti.duration - 10 / 24) < 0.15, `${ti.width}x${ti.height} ${ti.duration}`);
  assert.strictEqual((await run('dronetools', { mode: 'timelapse', files: [imgs[0]], outDir: P('x') })).status, 'error');
});

test('annullamento: il file parziale viene rimosso', opt, async () => {
  const job = mkJob();
  const pr = jobs.compress(job, { files: [SRC.big], targetMB: 3, outDir: P('out_cancel') }, () => {}, ctx);
  setTimeout(() => require('../src/main/runner').cancelJob(job), 600);
  const r = await pr; assert.strictEqual(r.status, 'cancelled');
  assert.ok(!fs.existsSync(P('out_cancel')) || fs.readdirSync(P('out_cancel')).length === 0);
});

test('youtube: sottotitoli, tratto, cartella per canale', () => {
  const a = yt.buildArgs({ item: 'https://youtu.be/x', mode: 'mp4', quality: '1080', outDir: '/o', subs: 'both', sectionStart: '1:30', sectionEnd: '2:45', byChannel: true });
  assert.ok(a.includes('--embed-subs') && a[a.indexOf('--sub-langs') + 1] === 'it,en');
  assert.strictEqual(a[a.indexOf('--download-sections') + 1], '*1:30-2:45');
  assert.ok(a[a.indexOf('-o') + 1].includes('%(channel,uploader)s'));
  const mp3 = yt.buildArgs({ item: 'https://youtu.be/x', mode: 'mp3', outDir: '/o', subs: 'it' });
  assert.ok(!mp3.includes('--embed-subs'));
  const pl = yt.buildArgs({ item: 'https://www.youtube.com/playlist?list=PL1', mode: 'mp3', outDir: '/o', byChannel: true });
  assert.ok(pl[pl.indexOf('-o') + 1].includes('playlist_title') && !pl[pl.indexOf('-o') + 1].includes('channel'));
  assert.ok(yt.validTime('90') && yt.validTime('1:30') && yt.validTime('01:02:03.5') && !yt.validTime('abc') && !yt.validTime('1:2:3:4') && !yt.validTime('-5'));
});

test('aggiornamento yt-dlp: checksum, versione, rifiuti', async () => {
  const dest = P('ytbin'); const payload = Buffer.from('#!/bin/sh\necho 2026.11.01\n'); const hash = crypto.createHash('sha256').update(payload).digest('hex');
  const name = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' }[process.platform];
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.11.01/';
  const mk = (sumHash, url = base + name) => async (u) => {
    if (u.includes('api.github.com')) return { ok: true, json: async () => ({ tag_name: '2026.11.01', assets: [{ name, browser_download_url: url }, { name: 'SHA2-256SUMS', browser_download_url: base + 'SHA2-256SUMS' }] }) };
    if (u.endsWith('SHA2-256SUMS')) return { ok: true, text: async () => `${sumHash}  ${name}\n` };
    return { ok: true, arrayBuffer: async () => payload };
  };
  assert.strictEqual((await updateYtdlp({ fetchFn: mk(hash), currentVersion: '2026.11.01', destDir: dest })).status, 'up-to-date');
  assert.strictEqual((await updateYtdlp({ fetchFn: mk('0'.repeat(64)), currentVersion: '2026.10.01', destDir: dest })).status, 'error');          // checksum errato
  assert.strictEqual((await updateYtdlp({ fetchFn: mk(hash, 'https://evil.example/x'), currentVersion: '2026.10.01', destDir: dest })).status, 'error'); // host non fidato
  assert.ok(!fs.existsSync(dest) || fs.readdirSync(dest).length === 0);
  const ok = await updateYtdlp({ fetchFn: mk(hash), currentVersion: '2026.10.01', destDir: dest, runVersion: async () => '2026.11.01' });
  assert.strictEqual(ok.status, 'updated'); assert.ok(fs.existsSync(ok.path));
  assert.deepStrictEqual(Object.keys(parseSums(`${hash}  a.exe\nzzz  b`)), ['a.exe']);
});

test('cronologia', () => {
  const h = createHistory(P('hist'), 3);
  for (let i = 0; i < 5; i++) h.add({ tool: 'convert', message: 'm' + i });
  assert.strictEqual(h.get().length, 3); assert.strictEqual(h.get()[0].message, 'm4');
  assert.strictEqual(createHistory(P('hist'), 3).get().length, 3);   // persistente
  h.clear(); assert.strictEqual(h.get().length, 0);
});
