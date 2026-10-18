// Catalogo formati del convertitore (usato sia dal processo main sia dall'interfaccia).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Formats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const X264 = ['-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k'];
  const list = [
    // --- Piu usati ---
    { id: 'mp4',  label: 'MP4',  kind: 'video', popular: true, ext: 'mp4', x264: true, args: [...X264, '-movflags', '+faststart'] },
    { id: 'mp3',  label: 'MP3',  kind: 'audio', popular: true, ext: 'mp3', args: ['-vn', '-c:a', 'libmp3lame', '-q:a', '0'] },
    { id: 'wav',  label: 'WAV',  kind: 'audio', popular: true, ext: 'wav', args: ['-vn', '-c:a', 'pcm_s16le'] },
    { id: 'mkv',  label: 'MKV',  kind: 'video', popular: true, ext: 'mkv', x264: true, args: [...X264] },
    // --- Video ---
    { id: 'mov',  label: 'MOV',  kind: 'video', ext: 'mov',  x264: true, args: [...X264, '-movflags', '+faststart'] },
    { id: 'avi',  label: 'AVI',  kind: 'video', ext: 'avi',  args: ['-c:v', 'mpeg4', '-q:v', '3', '-c:a', 'libmp3lame', '-q:a', '3'] },
    { id: 'webm', label: 'WEBM', kind: 'video', ext: 'webm', args: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus'] },
    { id: 'gif',  label: 'GIF',  kind: 'video', ext: 'gif',  args: ['-an', '-vf', 'fps=12,scale=480:-1:flags=lanczos', '-loop', '0'] },
    // --- Audio ---
    { id: 'flac', label: 'FLAC', kind: 'audio', ext: 'flac', args: ['-vn', '-c:a', 'flac'] },
    { id: 'm4a',  label: 'M4A',  kind: 'audio', ext: 'm4a',  args: ['-vn', '-c:a', 'aac', '-b:a', '256k'] },
    { id: 'aac',  label: 'AAC',  kind: 'audio', ext: 'aac',  args: ['-vn', '-c:a', 'aac', '-b:a', '256k'] },
    { id: 'ogg',  label: 'OGG',  kind: 'audio', ext: 'ogg',  args: ['-vn', '-c:a', 'libvorbis', '-q:a', '6'] },
    { id: 'opus', label: 'OPUS', kind: 'audio', ext: 'opus', args: ['-vn', '-c:a', 'libopus', '-b:a', '160k'] },
    // --- Immagini ---
    { id: 'png',  label: 'PNG',  kind: 'image', ext: 'png',  args: ['-frames:v', '1'] },
    { id: 'jpg',  label: 'JPG',  kind: 'image', ext: 'jpg',  args: ['-frames:v', '1', '-q:v', '2'] },
    { id: 'webp', label: 'WEBP', kind: 'image', ext: 'webp', args: ['-frames:v', '1', '-q:v', '80'] }
  ];
  // CRF per la compressione (solo formati x264)
  const compression = { none: null, high: 20, balanced: 24, strong: 28 };
  const ROT = { right: 'transpose=1', left: 'transpose=2', half: 'transpose=1,transpose=1' };
  const JPG_Q = { high: 2, medium: 5, low: 10 }, WEBP_Q = { high: 90, medium: 75, low: 50 };
  // Argomenti ffmpeg finali per un formato, con le opzioni scelte (ruota, dimensione/qualita foto, compressione video)
  function applyOptions(fmt, o) {
    o = o || {}; const args = fmt.args.slice(); const filters = [];
    if (fmt.kind !== 'audio' && ROT[o.rotate]) filters.push(ROT[o.rotate]);
    if (fmt.kind === 'image') {
      const m = parseInt(o.maxSide, 10);
      if ([800, 1280, 1920, 3840].includes(m)) filters.push(`scale='if(gt(iw,ih),min(${m},iw),-2)':'if(gt(iw,ih),-2,min(${m},ih))'`);
      const i = args.indexOf('-q:v');
      if (i >= 0 && fmt.id === 'jpg' && JPG_Q[o.quality]) args[i + 1] = String(JPG_Q[o.quality]);
      if (i >= 0 && fmt.id === 'webp' && WEBP_Q[o.quality]) args[i + 1] = String(WEBP_Q[o.quality]);
      args.push('-update', '1');
    }
    if (filters.length) { const i = args.indexOf('-vf'); if (i >= 0) args[i + 1] = filters.join(',') + ',' + args[i + 1]; else args.push('-vf', filters.join(',')); }
    const crf = fmt.x264 ? compression[o.compression] : null;
    if (crf) args.push('-crf', String(crf));
    return args;
  }
  return { list, compression, applyOptions, byId: (id) => list.find((f) => f.id === id) };
});
