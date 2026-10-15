'use strict';
// Server messages in the page's language (cookie freevis_lang, set by public/js/i18n.js).

const EN = {
};

function langOf(req) {
  const m = /(?:^|;\s*)freevis_lang=(ro|en)/.exec((req && req.headers && req.headers.cookie) || '');
  return m ? m[1] : 'ro';
}

/** tr(req or 'en'/'ro', 'Mesaj {x}', { x }) */
function tr(reqOrLang, ro, vars) {
  const lang = typeof reqOrLang === 'string' ? reqOrLang : langOf(reqOrLang);
  let out = (lang === 'en' && EN[ro]) || ro;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return out;
}

module.exports = { tr, langOf, EN };
