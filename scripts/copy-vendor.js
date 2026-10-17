// Copia la libreria QR in src/renderer/vendor (il renderer carica solo file locali, CSP 'self').
const fs = require('fs'), path = require('path');
try {
  const src = require.resolve('qrcode-generator');
  const dst = path.join(__dirname, '..', 'src', 'renderer', 'vendor', 'qrcode.js');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('[vendor] qrcode.js copiato da', src);
} catch (e) {
  console.error('[vendor] impossibile copiare qrcode-generator:', e.message);
  process.exit(1);
}
