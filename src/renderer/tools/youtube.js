'use strict';
window.Tools = window.Tools || {};
window.Tools.youtube = function (ctx) {
  const el = ctx.el, dock = ctx.dock, S = ctx.settings;
  // ultime scelte (o quelle impostate in Impostazioni) ricordate per ogni utente
  el('quality').value = S.ytQuality || 'max'; el('audiofmt').value = S.ytAudio || 'mp3'; el('cover').checked = S.ytCover !== false;
  el('quality').addEventListener('change', () => ctx.saveSettings({ ytQuality: el('quality').value }));
  el('audiofmt').addEventListener('change', () => ctx.saveSettings({ ytAudio: el('audiofmt').value }));
  el('cover').addEventListener('change', () => ctx.saveSettings({ ytCover: el('cover').checked }));
  function go(mode) {
    const links = el('links').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!links.length) { dock.setStatus('Inserisci almeno un link o una playlist.', 'error'); return; }
    dock.start('youtube', { links, mode, quality: el('quality').value, audioFmt: el('audiofmt').value, squareCover: el('cover').checked });
  }
  el('go-mp3').addEventListener('click', () => go('mp3'));
  el('go-mp4').addEventListener('click', () => go('mp4'));
};
