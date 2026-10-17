// Modelli di contenuto per il QR Studio: trasformano i campi in testo da codificare.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QRTemplates = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const wifiEsc = (s) => String(s || '').replace(/([\\;,:"])/g, '\\$1');
  const vEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([;,])/g, '\\$1');

  const types = {
    wifi: (f) => {
      const sec = { WPA: 'WPA', WEP: 'WEP', none: 'nopass' }[f.sec] || 'WPA';
      return `WIFI:T:${sec};S:${wifiEsc(f.ssid)};${sec === 'nopass' ? '' : `P:${wifiEsc(f.pass)};`}${f.hidden ? 'H:true;' : ''};`;
    },
    whatsapp: (f) => {
      const num = String(f.phone || '').replace(/[^\d]/g, '').replace(/^00/, '');
      const msg = String(f.message || '').trim();
      return `https://wa.me/${num}${msg ? '?text=' + encodeURIComponent(msg) : ''}`;
    },
    email: (f) => {
      const q = [];
      if (String(f.subject || '').trim()) q.push('subject=' + encodeURIComponent(f.subject.trim()));
      if (String(f.body || '').trim()) q.push('body=' + encodeURIComponent(f.body.trim()));
      return `mailto:${String(f.to || '').trim()}${q.length ? '?' + q.join('&') : ''}`;
    },
    vcard: (f) => {
      const n = String(f.first || '').trim(), c = String(f.last || '').trim();
      const L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEsc(c)};${vEsc(n)};;;`, `FN:${vEsc([n, c].filter(Boolean).join(' '))}`];
      if (f.org) L.push(`ORG:${vEsc(f.org)}`);
      if (f.title) L.push(`TITLE:${vEsc(f.title)}`);
      if (f.phone) L.push(`TEL;TYPE=CELL:${vEsc(f.phone)}`);
      if (f.email) L.push(`EMAIL:${vEsc(f.email)}`);
      if (f.url) L.push(`URL:${String(f.url).trim()}`);
      L.push('END:VCARD');
      return L.join('\n');
    }
  };
  return { types, compose: (type, f) => (types[type] ? types[type](f || {}) : '') };
});
