'use strict';
// Costruzione degli argomenti per yt-dlp (funzione pura, testabile).
const path = require('path');

const QUALITY = {
  max: 'bestvideo+bestaudio/best',
  '1080': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
  '720': 'bestvideo[height<=720]+bestaudio/best[height<=720]',
  '480': 'bestvideo[height<=480]+bestaudio/best[height<=480]',
  '360': 'bestvideo[height<=360]+bestaudio/best[height<=360]'
};

// Una riga e' una playlist se contiene list= oppure punta a /playlist
function isPlaylist(item) {
  return /[?&]list=/.test(item) || /\/playlist\?/.test(item);
}

// Playlist -> <out>/<Titolo playlist>/<NN - titolo>.<ext>   (cartella col titolo esatto su YouTube)
// Singolo    -> <out>/<titolo>.<ext>
function outputTemplate(outDir, playlist, byChannel) {
  if (playlist) return path.join(outDir, '%(playlist_title,playlist_id)s', '%(playlist_index)02d - %(title)s.%(ext)s');
  return byChannel ? path.join(outDir, '%(channel,uploader)s', '%(title)s.%(ext)s') : path.join(outDir, '%(title)s.%(ext)s');
}

// Tempo valido: secondi (90), mm:ss (1:30) o hh:mm:ss, con decimali facoltativi
const TIME_RE = /^\d+(:\d{1,2}){0,2}(\.\d+)?$/;
const validTime = (t) => TIME_RE.test(String(t || '').trim());

function buildArgs(o) {
  const playlist = isPlaylist(o.item);
  const args = ['--newline', '--yes-playlist', '--concurrent-fragments', '4',
    '--default-search', 'ytsearch:'];
  if (o.ffmpegDir) args.push('--ffmpeg-location', o.ffmpegDir);
  if (o.jsRuntime) args.push('--js-runtimes', o.jsRuntime);

  const langs = { it: 'it', en: 'en', both: 'it,en' }[o.subs];
  const subArgs = ['--write-subs', '--write-auto-subs', '--sub-langs', langs];

  if (o.mode === 'subs') {
    // solo sottotitoli: niente video, file .srt accanto (o nella cartella della playlist)
    if (langs) args.push('--skip-download', ...subArgs, '--convert-subs', 'srt');
  } else if (o.mode === 'mp3') {
    const fmt = o.audioFmt === 'best' ? 'best' : 'mp3';
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', fmt, '--audio-quality', '0',
      '--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg');
    if (o.squareCover) {
      args.push('--ppa', 'EmbedThumbnail+ffmpeg_o:-c:v mjpeg -q:v 2 -vf crop="\'if(gt(ih,iw),iw,ih)\':\'if(gt(iw,ih),ih,iw)\'"');
    }
    if (playlist) {
      args.push('--parse-metadata', '%(album,playlist_title|)s:%(meta_album)s',
        '--parse-metadata', '%(playlist_index|)s:%(meta_track)s');
    }
    // l'audio non puo contenere sottotitoli: vengono salvati in un file .srt accanto al brano
    if (langs) args.push(...subArgs, '--convert-subs', 'srt');
  } else {
    args.push('-f', QUALITY[o.quality] || QUALITY.max, '--recode-video', 'mp4');
    // nel video i sottotitoli vengono incorporati (si attivano dal lettore)
    if (langs) args.push(...subArgs, '--embed-subs');
  }
  if (o.mode !== 'subs' && o.sectionStart && o.sectionEnd) {
    args.push('--download-sections', `*${String(o.sectionStart).trim()}-${String(o.sectionEnd).trim()}`, '--force-keyframes-at-cuts');
  }
  args.push('-o', outputTemplate(o.outDir, playlist, o.byChannel));
  // "--" impedisce che una riga che inizia con "-" venga interpretata come opzione
  args.push('--', o.item);
  return args;
}

module.exports = { buildArgs, isPlaylist, outputTemplate, validTime, QUALITY };
