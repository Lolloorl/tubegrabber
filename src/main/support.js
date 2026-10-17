'use strict';
// Costruisce i link per inviare una segnalazione: Gmail nel browser oppure programma di posta.
// Il testo lungo viene accorciato nei link (hanno limiti di lunghezza); quello completo va negli appunti.
const GMAIL_MAX = 1500, MAILTO_MAX = 700;

function clipText(t, max) {
  t = String(t || '');
  if (t.length <= max) return t;
  return t.slice(0, max) + '\n[...]\n(Testo completo copiato negli appunti: incollalo qui con Ctrl+V)';
}

function mailUrls({ to, subject, text }) {
  const e = encodeURIComponent;
  return {
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${e(to)}&su=${e(subject)}&body=${e(clipText(text, GMAIL_MAX))}`,
    mailto: `mailto:${to}?subject=${e(subject)}&body=${e(clipText(text, MAILTO_MAX))}`
  };
}

module.exports = { mailUrls, clipText };
