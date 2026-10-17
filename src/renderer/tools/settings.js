'use strict';
window.Tools = window.Tools || {};
window.Tools.settings = function (ctx) {
  const el = ctx.el, S = ctx.settings, api = ctx.api;
  el('outdir').value = S.outDir || ''; el('openfolder').checked = !!S.openFolder; el('notify').checked = S.notify !== false;
  el('ytq').value = S.ytQuality || 'max'; el('yta').value = S.ytAudio || 'mp3'; el('ytc').checked = S.ytCover !== false;
  el('autoyt').checked = S.autoYtdlp !== false; el('chkupd').checked = S.checkUpdates !== false;
  api.info().then((i) => { el('mail').textContent = i.supportEmail || '(non configurato)'; });

  el('outdir').addEventListener('change', () => ctx.saveSettings({ outDir: el('outdir').value }));
  el('browse').addEventListener('click', async () => { const d = await api.pickFolder(el('outdir').value); if (d) { el('outdir').value = d; ctx.saveSettings({ outDir: d }); } });
  el('openfolder').addEventListener('change', () => ctx.saveSettings({ openFolder: el('openfolder').checked }));
  el('notify').addEventListener('change', () => ctx.saveSettings({ notify: el('notify').checked }));
  el('ytq').addEventListener('change', () => ctx.saveSettings({ ytQuality: el('ytq').value }));
  el('yta').addEventListener('change', () => ctx.saveSettings({ ytAudio: el('yta').value }));
  el('ytc').addEventListener('change', () => ctx.saveSettings({ ytCover: el('ytc').checked }));
  el('autoyt').addEventListener('change', () => ctx.saveSettings({ autoYtdlp: el('autoyt').checked }));
  el('chkupd').addEventListener('change', () => ctx.saveSettings({ checkUpdates: el('chkupd').checked }));
  el('chknow').addEventListener('click', () => ctx.checkUpdates());

  // strumenti extra: stato, problemi (utile all'admin) e aggiornamento dell'elenco
  el('extra').checked = S.extraTools !== false;
  const SRC = { online: 'aggiornati online adesso', salvati: 'ultima copia salvata (internet non raggiunto)', inclusi: 'solo quelli inclusi nell\'app' };
  function renderExtra(i) {
    el('extrainfo').textContent = `${i.tools.length} strumenti extra caricati`;
    el('extrasrc').textContent = SRC[i.source] || '';
    const p = el('problems'); p.hidden = !i.problems.length;
    p.textContent = i.problems.length ? 'Alcuni strumenti non sono stati caricati:\n' + i.problems.map((x) => `• ${x.id}\n   ` + x.errors.join('\n   ')).join('\n') : '';
  }
  ctx.reloadRecipes(false).then(renderExtra);
  el('extra').addEventListener('change', async () => { await ctx.saveSettings({ extraTools: el('extra').checked }); renderExtra(await ctx.reloadRecipes(true)); });
  el('extrarefresh').addEventListener('click', async () => { el('extrarefresh').disabled = true; renderExtra(await ctx.reloadRecipes(true)); el('extrarefresh').disabled = false; });

  const say = (t, level) => { const s = el('toolstatus'); s.textContent = t; s.className = 'status' + (level ? ' ' + level : ''); };
  function render(b) {
    el('ytv').textContent = b.ytdlp ? `Versione ${b.ytdlpVersion || 'sconosciuta'}` : 'Non trovato';
    el('ffv').textContent = b.ffmpeg ? `${b.ffmpegVersion || 'installato'}${b.ffmpegUpdated ? ' · aggiornato dall\'app' : ' · incluso nell\'app'}` : 'Non trovato';
    el('reset-ff').hidden = !b.ffmpegUpdated;
    el('up-ff').hidden = !b.canUpdateFfmpeg;
    el('ffhint').textContent = b.canUpdateFfmpeg ? 'ffmpeg cambia raramente: aggiornalo solo se serve (scarica circa 150 MB).' : 'Su Mac ffmpeg si aggiorna insieme all\'app.';
  }
  ctx.refreshTools().then(render);

  const MSG = {
    updated: ['Aggiornamento completato!', 'ok'], 'up-to-date': ['Sei già all\'ultima versione.', 'ok'],
    busy: ['Aspetta la fine delle operazioni in corso e riprova.', 'warn']
  };
  async function update(which, btn) {
    btn.disabled = true; say(which === 'ffmpeg' ? 'Scarico ffmpeg (circa 150 MB), può richiedere qualche minuto…' : 'Controllo e scarico yt-dlp…', 'info');
    try {
      const r = await api.updateTool(which);
      const m = MSG[r.status]; say(m ? m[0] : (r.message || 'Aggiornamento non riuscito.'), m ? m[1] : 'error');
      if (r.tools) render(r.tools);
    } catch (e) { say('Aggiornamento non riuscito: ' + e.message, 'error'); }
    btn.disabled = false;
  }
  el('up-yt').addEventListener('click', () => update('ytdlp', el('up-yt')));
  el('up-ff').addEventListener('click', () => update('ffmpeg', el('up-ff')));
  el('reset-ff').addEventListener('click', async () => { render(await api.resetFfmpeg()); say('Ora uso l\'ffmpeg incluso nell\'app.', 'ok'); });
};
