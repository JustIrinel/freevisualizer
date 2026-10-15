'use strict';
// Server messages in the page's language (cookie freevis_lang, set by public/js/i18n.js).

const EN = {
  'Fișier prea mare': 'File too large',
  'Nume invalid': 'Invalid name',
  'Proiectul nu există': "The project doesn't exist",
  'Format nesuportat': 'Unsupported format',
  'Fișier gol': 'Empty file',
  'Modelul nu există': "The model doesn't exist",
  'Nu pot accesa Open Fixture Library ({err}). Verifică internetul sau importă fișierul .json manual.': "Can't reach the Open Fixture Library ({err}). Check your internet connection or import the .json file manually.",
  'Nu pot descărca fixtura ({err}).': "Can't download the fixture ({err}).",
  'Cheie de fixtură invalidă': 'Invalid fixture key',
  'Lipsește pachetul @anthropic-ai/sdk. Rulează „npm install” în folderul FreeVisualizer.': 'The @anthropic-ai/sdk package is missing. Run “npm install” in the FreeVisualizer folder.',
  'Adaugă cheia API Claude în Setări → Asistent.': 'Add your Claude API key in Settings → Assistant.',
  'Conversație goală': 'Empty conversation',
  'Cheia API nu e validă. Verific-o în Setări → Asistent.': "The API key isn't valid. Check it in Settings → Assistant.",
  'Cheia API nu are acces la acest model.': "The API key doesn't have access to this model.",
  'Prea multe cereri deodată. Mai încearcă peste un minut.': 'Too many requests at once. Try again in a minute.',
  'Cerere respinsă de Claude: {err}': 'Request rejected by Claude: {err}',
  'Nu mă pot conecta la Claude. Verifică internetul.': "Can't connect to Claude. Check your internet connection.",
  'Eroare Claude ({status}): {err}': 'Claude error ({status}): {err}',
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
