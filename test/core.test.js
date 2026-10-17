const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const drone = require('../src/main/drone');
const yt = require('../src/main/youtube');
const { compareVersions, checkForUpdate } = require('../src/main/updater');
const jobs = require('../src/main/jobs');
const crypto = require('crypto');
const { updateYtdlp, parseSums } = require('../src/main/ytdlp-update');
const { updateFfmpeg } = require('../src/main/ffmpeg-update');
const Q = require('../src/shared/qrtemplates');
const { mailUrls, clipText } = require('../src/main/support');


const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-'));
const P2 = (...a) => path.join(tmp, ...a);
const mkJob = () => ({ cancelled: false, procs: new Set() });
const ctx = { bins: { ffmpeg: 'ffmpeg', ytdlp: null, jsRuntime: null }, writeLog() {} };

test('drone: niente -shortest, durate gestite', () => {
  const a = drone.buildSyncArgs({ video: 'v.mp4', audio: 'a.mp3', out: 'o.mp4', vDur: 10, aDur: 6 });
  assert.ok(!a.includes('-shortest'));
  assert.ok(a.includes('apad=whole_dur=10'));
  const b = drone.buildSyncArgs({ video: 'v.mp4', audio: 'a.mp3', out: 'o.mp4', vDur: 10, aDur: 14 });
  assert.ok(!b.includes('-shortest') && !b.some((x) => String(x).startsWith('apad')));
  const c = drone.buildSyncArgs({ video: 'v.mp4', audio: 'a.mp3', out: 'o.mp4', vDur: null, aDur: null });
  assert.ok(!c.includes('-t') && !c.includes('-shortest'));
});

test('drone: abbinamento per nome e fallback 1+1', () => {
  const r = drone.pairFiles(['/x/DJI_01.MP4', '/x/dji_01.wav', '/x/DJI_02.mp4', '/x/altro.mp3']);
  assert.strictEqual(r.pairs.length, 1); assert.deepStrictEqual(r.noAudio, ['/x/DJI_02.mp4']); assert.deepStrictEqual(r.unmatched, ['/x/altro.mp3']);
  assert.strictEqual(drone.pairFiles(['/x/a.mp4', '/x/b.mp3']).pairs.length, 1);
});

test('youtube: playlist -> cartella col titolo, singolo -> no cartella, "--" prima del link', () => {
  const p = yt.buildArgs({ item: 'https://www.youtube.com/playlist?list=PL123', mode: 'mp3', outDir: '/out', audioFmt: 'mp3' });
  assert.ok(p.find((x) => x.includes('%(playlist_title,playlist_id)s')));
  const s = yt.buildArgs({ item: 'https://youtu.be/abc', mode: 'mp4', quality: '720', outDir: '/out' });
  assert.ok(!s.find((x) => x.includes('playlist_title')));
  const bad = yt.buildArgs({ item: '--exec calc', mode: 'mp4', outDir: '/out' });
  assert.strictEqual(bad[bad.length - 2], '--'); assert.strictEqual(bad[bad.length - 1], '--exec calc');
});

test('updater: confronto versioni e risposte', async () => {
  assert.strictEqual(compareVersions('2.1.0', '2.0.9'), 1);
  assert.strictEqual(compareVersions('v2.0.0', '2.0.0'), 0);
  assert.strictEqual(compareVersions('1.9.9', '2.0.0'), -1);
  const f = (d) => async () => ({ ok: true, json: async () => d });
  const r = await checkForUpdate({ url: 'https://x/y.json', currentVersion: '2.0.0', platform: 'win', fetchFn: f({ version: '2.1.0', downloads: { win: 'https://d/x.exe' } }) });
  assert.strictEqual(r.status, 'available'); assert.strictEqual(r.url, 'https://d/x.exe');
  const http = await checkForUpdate({ url: 'https://x/y.json', currentVersion: '2.0.0', platform: 'win', fetchFn: f({ version: '2.1.0', downloads: { win: 'http://evil/x.exe' } }) });
  assert.strictEqual(http.url, null);
  assert.strictEqual((await checkForUpdate({ url: 'https://x', currentVersion: '2.1.0', platform: 'win', fetchFn: f({ version: '2.1.0' }) })).status, 'up-to-date');
  assert.strictEqual((await checkForUpdate({ url: 'https://x', currentVersion: '2.0.0', platform: 'win', fetchFn: async () => { throw new Error('x'); } })).status, 'error');
});

test('E2E drone con ffmpeg reale: il video resta completo', { skip: !hasFfmpeg }, async () => {
  const dir = path.join(tmp, 'in with spaces & (odd)'); fs.mkdirSync(dir);
  const v = path.join(dir, 'clip.mp4'), a = path.join(dir, 'clip.wav'), out = path.join(tmp, 'out');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=10:size=320x240:rate=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', v], { stdio: 'ignore' });
  for (const [dur, label] of [[6, 'corto'], [14, 'lungo']]) {
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${dur}`, a], { stdio: 'ignore' });
    const o = path.join(out, label);
    const res = await jobs.drone(mkJob(), { files: [v, a], outDir: o }, () => {}, ctx);
    assert.strictEqual(res.status, 'ok', res.message);
    const f = path.join(o, 'clip.mp4');
    const vd = await drone.probeDuration('ffmpeg', f);
    assert.ok(vd >= 9.9 && vd <= 10.2, `durata output ${label}: ${vd}`);
    // frame video realmente presenti: 10 s * 25 fps = 250 (con -shortest erano ~149)
    const r = require('child_process').spawnSync('ffmpeg', ['-i', f, '-map', '0:v:0', '-f', 'null', '-'], { encoding: 'utf8' });
    const frames = +/frame=\s*(\d+)/g.exec(String(r.stderr).split('\r').join('\n').split('\n').filter((l) => /frame=/.test(l)).pop())[1];
    assert.ok(frames >= 249 && frames <= 251, `fotogrammi ${label}: ${frames}`);
  }
});

test('E2E convertitore: wav->mp3, mp4->mp3, nome occupato non sovrascrive', { skip: !hasFfmpeg }, async () => {
  const src = path.join(tmp, 'song.wav'); const out = path.join(tmp, 'conv');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=duration=2', src], { stdio: 'ignore' });
  const events = [];
  let r = await jobs.convert(mkJob(), { files: [src], format: 'mp3', outDir: out }, (e) => events.push(e), ctx);
  assert.strictEqual(r.status, 'ok', r.message); assert.ok(fs.existsSync(path.join(out, 'song.mp3')));
  r = await jobs.convert(mkJob(), { files: [src], format: 'mp3', outDir: out }, () => {}, ctx);
  assert.ok(fs.existsSync(path.join(out, 'song (1).mp3')));
  assert.ok(events.some((e) => e.type === 'item' && e.state === 'ok'));
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
  const dest = P2('ytbin'); const payload = Buffer.from('#!/bin/sh\necho 2026.11.01\n'); const hash = crypto.createHash('sha256').update(payload).digest('hex');
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


test('aggiornamento ffmpeg: checksum e solo Windows', async () => {
  const ZIP = 'ffmpeg-master-latest-win64-gpl.zip', base = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/';
  const data = Buffer.from('zipfinto'); const hash = crypto.createHash('sha256').update(data).digest('hex');
  const mk = (h) => async (u) => {
    if (u.includes('api.github.com')) return { ok: true, json: async () => ({ assets: [{ name: ZIP, browser_download_url: base + ZIP }, { name: 'checksums.sha256', browser_download_url: base + 'checksums.sha256' }] }) };
    if (u.endsWith('checksums.sha256')) return { ok: true, text: async () => `${h}  ${ZIP}\n` };
    return { ok: true, arrayBuffer: async () => data };
  };
  const dest = P2('ffdest');
  const extract = async (zip, inner, out) => { const f = path.join(out, ...inner.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'EXE'); };
  assert.strictEqual((await updateFfmpeg({ fetchFn: mk(hash), destDir: dest, platform: 'darwin' })).status, 'unsupported');
  assert.strictEqual((await updateFfmpeg({ fetchFn: mk('1'.repeat(64)), destDir: dest, platform: 'win32', extract })).status, 'error');
  assert.ok(!fs.existsSync(path.join(dest, 'ffmpeg.exe')), 'checksum errato: nessun file installato');
  const ok = await updateFfmpeg({ fetchFn: mk(hash), destDir: dest, platform: 'win32', extract, runVersion: async () => 'v' });
  assert.strictEqual(ok.status, 'updated'); assert.strictEqual(fs.readFileSync(ok.path, 'utf8'), 'EXE');
  assert.strictEqual((await updateFfmpeg({ fetchFn: mk(hash), destDir: P2('ffdest2'), platform: 'win32', extract, runVersion: async () => null })).status, 'error');
});

test('modelli QR: wifi, whatsapp, email, vcard', () => {
  assert.strictEqual(Q.compose('wifi', { ssid: 'Casa;Mia', pass: 'a:b,c"d', sec: 'WPA' }), 'WIFI:T:WPA;S:Casa\\;Mia;P:a\\:b\\,c\\"d;;');
  assert.strictEqual(Q.compose('wifi', { ssid: 'Aperta', sec: 'none', hidden: true }), 'WIFI:T:nopass;S:Aperta;H:true;;');
  assert.strictEqual(Q.compose('whatsapp', { phone: '+39 347 123-4567', message: 'Ciao & grazie' }), 'https://wa.me/393471234567?text=Ciao%20%26%20grazie');
  assert.strictEqual(Q.compose('whatsapp', { phone: '0039 333 1112222' }), 'https://wa.me/393331112222');
  assert.strictEqual(Q.compose('email', { to: 'a@b.it', subject: 'Ciao mondo', body: 'x y' }), 'mailto:a@b.it?subject=Ciao%20mondo&body=x%20y');
  assert.strictEqual(Q.compose('email', { to: 'a@b.it' }), 'mailto:a@b.it');
  const v = Q.compose('vcard', { first: 'Mario', last: 'Rossi', org: 'Rossi, Srl', phone: '+39 333', email: 'm@r.it', url: 'https://r.it' });
  assert.ok(v.startsWith('BEGIN:VCARD\nVERSION:3.0\nN:Rossi;Mario;;;\nFN:Mario Rossi') && v.includes('ORG:Rossi\\, Srl') && v.endsWith('END:VCARD'));
  assert.strictEqual(Q.compose('sconosciuto', {}), '');
});

test('segnalazione: link di posta con testo accorciato', () => {
  const long = 'riga di log\n'.repeat(400);
  const u = mailUrls({ to: 'a@b.it', subject: 'Errore: prova & test', text: long });
  assert.ok(u.gmail.startsWith('https://mail.google.com/mail/?view=cm&fs=1&to=a%40b.it&su=Errore'));
  assert.ok(u.mailto.startsWith('mailto:a@b.it?subject=') && decodeURIComponent(u.mailto).includes('Ctrl+V'));
  assert.ok(u.gmail.length < 6000 && u.mailto.length < 2200, `${u.gmail.length} ${u.mailto.length}`);
  assert.strictEqual(clipText('corto', 100), 'corto');
  assert.ok(!u.gmail.includes(' ') && !u.mailto.includes('\n'));
});

// ======================= STRUMENTI A RICETTA =======================
const R = require('../src/shared/recipes');
const { loadAll, parseList } = require('../src/main/recipes-load');
const EX = require('../recipes/strumenti.json').tools;
const base = () => JSON.parse(JSON.stringify(EX[0]));

test('ricette: gli esempi inclusi sono tutti validi', () => {
  for (const t of EX) assert.deepStrictEqual(R.validate(t), [], t.id);
});

test('ricette: regole di sicurezza e messaggi chiari', () => {
  const bad = (mut, re) => { const r = base(); mut(r); const e = R.validate(r).join(' | '); assert.ok(re.test(e), `atteso ${re} in: ${e}`); };
  bad((r) => { r.run.program = 'powershell'; }, /run\.program/);
  bad((r) => { r.id = 'Ab'; }, /"id"/);
  bad((r) => { r.run.output = '../fuori/{name}.mp3'; }, /senza cartelle/);
  bad((r) => { r.run.output = 'C:\\x\\{name}.mp3'; }, /senza cartelle/);
  bad((r) => { r.run.args = ['-i', '{input}', '-report', '{output}']; }, /non è consentita/);
  bad((r) => { r.run.args[1] = '{input}'; r.run.args.splice(2, 0, '{sconosciuto}'); }, /\{sconosciuto\}/);
  bad((r) => { r.run.args.pop(); r.run.args.push('fuori.mp3'); }, /ultimo argomento/);
  bad((r) => { r.options.push({ id: 'fmt', type: 'check', label: 'x', default: true }); }, /due volte/);
  bad((r) => { r.options[0].default = 'ogg'; }, /default/);
  bad((r) => { r.run.args.splice(2, 0, { when: { nonesiste: 'x' }, args: ['-an'] }); }, /non esiste/);
  const y = JSON.parse(JSON.stringify(EX[4]));
  y.run.args.unshift('--exec', 'calc'); assert.ok(/--exec/.test(R.validate(y).join()));
  y.run.args = y.run.args.filter((a) => a !== '--exec' && a !== 'calc'); y.run.args.unshift('--exec=calc'); assert.ok(/--exec/.test(R.validate(y).join()));
});

test('ricette: valori ripuliti, argomenti condizionali, unione online', () => {
  const r = EX[1];
  assert.deepStrictEqual(R.sanitizeValues(r, { start: -5, secs: 999, width: 'abc', fps: 15 }), { start: 0, secs: 30, width: 480, fps: 15 });
  assert.strictEqual(R.sanitizeValues(EX[0], { fmt: 'exe; rm -rf' }).fmt, 'mp3');
  const a = R.buildArgs(EX[0], { fmt: 'flac' }, { input: 'a.mp4', output: 'o.flac', name: 'a', outdir: '.' });
  assert.deepStrictEqual(a, ['-i', 'a.mp4', '-vn', '-c:a', 'flac', 'o.flac']);
  assert.strictEqual(R.outputName(EX[0], { fmt: 'mp3' }, 'a:b/c'), 'a_b_c.mp3');
  const merged = R.merge(EX.slice(0, 2), [{ ...EX[1], name: 'GIF nuova' }, { id: 'nuovo-strumento' }, { id: 'estrai-audio', disabled: true }]);
  assert.deepStrictEqual(merged.map((x) => x.id), ['video-in-gif', 'nuovo-strumento']); assert.strictEqual(merged[0].name, 'GIF nuova');
});

test('ricette: caricamento online, copia salvata, incluse e file rotto', async () => {
  const d = P2('rc'); fs.mkdirSync(d, { recursive: true });
  const bundledFile = path.join(d, 'inclusi.json'), cacheFile = path.join(d, 'cache.json');
  fs.writeFileSync(bundledFile, JSON.stringify({ tools: [EX[0]] }));
  const online = JSON.stringify({ tools: [EX[1], { ...EX[2], run: { program: 'cmd', args: ['x'] } }] });   // la seconda e' non valida
  const okFetch = async () => ({ ok: true, text: async () => online });
  const a = await loadAll({ bundledFile, remoteUrl: 'https://x/y.json', cacheFile, fetchFn: okFetch });
  assert.strictEqual(a.source, 'online'); assert.deepStrictEqual(a.tools.map((t) => t.id), ['estrai-audio', 'video-in-gif']);
  assert.ok(a.problems.length === 1 && a.problems[0].id === 'ruota-video');
  const down = async () => { throw new Error('offline'); };
  const b = await loadAll({ bundledFile, remoteUrl: 'https://x/y.json', cacheFile, fetchFn: down });
  assert.strictEqual(b.source, 'salvati'); assert.strictEqual(b.tools.length, 2);
  fs.rmSync(cacheFile);
  assert.strictEqual((await loadAll({ bundledFile, remoteUrl: 'https://x/y.json', cacheFile, fetchFn: down })).tools.length, 1);
  assert.strictEqual((await loadAll({ bundledFile, remoteUrl: 'https://x/y.json', cacheFile, fetchFn: okFetch, useRemote: false })).source, 'inclusi');
  assert.ok(parseList('{rotto', 'x').problems[0].errors[0].includes('non valido'));
});

test('ricette: esecuzione vera con ffmpeg (audio, GIF, rotazione, foto)', { skip: !hasFfmpeg }, async () => {
  const rc = { bins: { ffmpeg: 'ffmpeg' }, writeLog() {}, recipes: new Map(EX.map((t) => [t.id, t])) };
  const vid = P2('r_src.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', vid]);
  const go = (id, values, inputs, extra = {}) => jobs.recipe(mkJob(), { id, values, inputs, outDir: P2('r_out'), ...extra }, () => {}, rc);
  let r = await go('estrai-audio', { fmt: 'mp3' }, [vid]); assert.strictEqual(r.status, 'ok', r.message);
  assert.ok(r.outputs[0].endsWith('r_src.mp3') && fs.statSync(r.outputs[0]).size > 1000);
  r = await go('video-in-gif', { start: 1, secs: 2, width: 200, fps: 8 }, [vid]); assert.strictEqual(fs.readFileSync(r.outputs[0]).slice(0, 3).toString(), 'GIF');
  r = await go('ruota-video', { dir: 'right' }, [vid]); const ri = await media2(r.outputs[0]); assert.ok(ri.includes('360x640'), ri);
  const jpg = P2('r_foto.jpg'); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=3000x2000:rate=1:duration=1', '-frames:v', '1', '-update', '1', jpg]);
  r = await go('foto-leggere', { maxw: '800', q: 6 }, [jpg]); assert.ok(/800x53[34]/.test(await media2(r.outputs[0])), 'foto 800 px');
  assert.strictEqual((await go('estrai-audio', {}, [jpg])).status, 'error');                    // estensione non ammessa
  assert.strictEqual((await go('inesistente', {}, [vid])).status, 'error');                      // id sconosciuto
  assert.strictEqual((await go('estrai-audio', { fmt: 'wav' }, [vid])).status, 'ok');
});
async function media2(f) { const { execFileSync: x } = require('child_process'); try { x('ffmpeg', ['-hide_banner', '-i', f], { stdio: 'pipe' }); return ''; } catch (e) { return String(e.stderr); } }

test('ricette: yt-dlp (programma finto) riceve il comando giusto', { skip: process.platform === 'win32' }, async () => {
  const fake = P2('fake-ytdlp.sh'), argsFile = P2('args.txt');
  fs.writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${argsFile}"\necho "[download]  50.0% of 1MiB"\nexit 0\n`, { mode: 0o755 });
  const rc = { bins: { ytdlp: fake, ffmpegDir: '/fx', jsRuntime: 'deno:/d' }, writeLog() {}, recipes: new Map(EX.map((t) => [t.id, t])) };
  const ev = [];
  const r = await jobs.recipe(mkJob(), { id: 'sottotitoli-youtube', values: { lang: 'it,en' }, inputs: ['https://youtu.be/a', '--exec calc'], outDir: P2('yt_out') }, (e) => ev.push(e), rc);
  assert.strictEqual(r.status, 'ok', r.message);
  const lines = fs.readFileSync(argsFile, 'utf8').split('\n');
  assert.ok(lines.includes('--skip-download') && lines.includes('it,en') && lines.includes('--ffmpeg-location') && lines.includes('/fx'));
  const iLink = lines.indexOf('https://youtu.be/a'); assert.strictEqual(lines[iLink - 1], '--');
  assert.ok(lines.includes('--exec calc') && lines[lines.indexOf('--exec calc') - 1] === '--', 'una riga che sembra un\'opzione resta un semplice link');
  assert.ok(lines[lines.indexOf('-o') + 1].endsWith('%(title)s.%(ext)s') && lines[lines.indexOf('-o') + 1].startsWith(P2('yt_out')));
  assert.ok(ev.some((e) => e.type === 'progress'));
});
