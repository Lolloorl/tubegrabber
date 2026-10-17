'use strict';
// Home: i 4 strumenti come grandi pulsanti; passando il cursore compare cosa fa ciascuno.
window.Tools = window.Tools || {};
window.Tools.home = function (ctx) {
  const svg = (inner) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ITEMS = [
    { tool: 'youtube', color: '#ff5a5f', title: 'Scarica da YouTube', tag: 'Video e musica, anche playlist intere',
      icon: svg('<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"/>'),
      desc: 'Incolla uno o più link e scarica video MP4 o musica MP3 con copertina. Ogni playlist va in una cartella col suo titolo.',
      ex: ['Una playlist intera in MP3', 'Un video in 1080p', 'Più link in un colpo solo'] },
    { tool: 'convert', color: '#f2a93b', title: 'Converti file', tag: 'MP4, MP3, WAV, MKV e molti altri',
      icon: svg('<path d="M4 8h13l-3-3m3 3l-3 3M20 16H7l3-3m-3 3l3 3"/>'),
      desc: 'Trascina i file e scegli il formato di arrivo. Puoi anche ridurre il peso dei video con la compressione.',
      ex: ['Video → MP3', 'MOV → MP4', 'WAV → MP3'] },
    { tool: 'drone', color: '#9b7bff', title: 'Drone Sync', tag: 'Unisci video e audio del drone',
      icon: svg('<circle cx="5.5" cy="5.5" r="2.5"/><circle cx="18.5" cy="5.5" r="2.5"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/><path d="M8 8l8 8M16 8l-8 8"/>'),
      desc: 'Abbina ogni video all\'audio con lo stesso nome. Il video resta sempre completo, anche se l\'audio è più corto.',
      ex: ['DJI_0001.mp4 + DJI_0001.wav', 'Più clip insieme'] },
    { tool: 'qr', color: '#2fc4b2', title: 'QR Studio', tag: 'QR personalizzati, anche con logo',
      icon: svg('<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><path d="M14 14h3v3h-3zM20 14v1M14 20h1M18 18h3v3h-3z"/>'),
      desc: 'Crea QR con forme, colori e logo. Per link, Wi-Fi, WhatsApp, e-mail e biglietto da visita.',
      ex: ['Wi-Fi di casa', 'Link con il tuo logo', 'Biglietto da visita'] }
  ];

  const ICONS = {
    download: svg('<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"/>'), convert: svg('<path d="M4 8h13l-3-3m3 3l-3 3M20 16H7l3-3m-3 3l3 3"/>'),
    audio: svg('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
    scissors: svg('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 8l12 9M8 16L20 7"/>'),
    image: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-5 4 4 3-3 6 6"/>'),
    film: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v14M16 5v14M3 12h18"/>'),
    tag: svg('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>'),
    star: svg('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'),
    wave: svg('<path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h-2"/>')
  };
  const makeCard = (it, i, grid) => {
    const b = document.createElement('button');
    b.className = 'card'; b.style.setProperty('--tool', it.color); b.type = 'button';
    b.innerHTML = `<span class="key" aria-hidden="true">${i + 1 <= 9 ? i + 1 : ''}</span>${it.icon}<strong class="name"></strong>
      <div class="swap"><span class="tag"></span><div class="more"><p></p><ul></ul><span class="go">Apri →</span></div></div>`;
    b.querySelector('.name').textContent = it.title;
    b.querySelector('.tag').textContent = it.tag;
    b.querySelector('.more p').textContent = it.desc;
    (it.ex || []).forEach((x) => { const li = document.createElement('li'); li.textContent = x; b.querySelector('ul').appendChild(li); });
    b.setAttribute('aria-label', `${it.title}. ${it.desc}`);
    b.addEventListener('click', () => ctx.openTool(it.tool));
    grid.appendChild(b);
  };
  ITEMS.forEach((it, i) => makeCard(it, i, ctx.el('cards')));
  // strumenti extra (ricette incluse o pubblicate online)
  const extra = (ctx.recipes() || []).map((r) => ({ tool: 'recipe:' + r.id, color: r.color || '#8b93a7', title: r.name, tag: r.tagline || '', desc: r.description || r.tagline || '', ex: r.examples || [], icon: ICONS[r.icon] || ICONS.star }));
  if (extra.length) ctx.el('extratitle').hidden = false;
  extra.forEach((it, j) => makeCard(it, ITEMS.length + j, ctx.el('cards2')));
  ITEMS.push(...extra);

  // tasti 1-4 aprono lo strumento (solo finche questa Home e' visibile)
  const onKey = (e) => {
    if (!ctx.root.isConnected) { window.removeEventListener('keydown', onKey); return; }
    if (!ctx.root.closest('.panel.active') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
    const it = ITEMS[Number(e.key) - 1];
    if (it) ctx.openTool(it.tool);
  };
  window.addEventListener('keydown', onKey);
};
