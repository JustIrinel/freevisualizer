// Bilingual interface (Română / English). The Romanian text is the key:
// tr('Salvează') → 'Save' when English is on. Changing the language reloads the page.
import EN from './lang/en.js';

const KEY = 'freevis.lang.v1';
export const LANGS = { ro: 'Română', en: 'English' };

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS[saved]) return saved;
  } catch (_) { /* storage blocked */ }
  return 'ro';
}

export const lang = detect();
const dict = lang === 'en' ? EN : null;

// The server (error messages) and the desktop menu follow the same choice.
try { document.cookie = `freevis_lang=${lang}; path=/; max-age=31536000; SameSite=Lax`; } catch (_) { /* no cookies */ }
if (typeof document !== 'undefined') document.documentElement.lang = lang;

/**
 * Translate a Romanian UI string. `{name}` placeholders are filled from `vars`
 * after translation, so the English text can put them in another order.
 */
export function tr(ro, vars) {
  let out = (dict && dict[ro]) || ro;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return out;
}

/** Singular / plural: tp(n, 'o fixtură', '{n} fixturi'). */
export function tp(n, one, many, vars) {
  return tr(n === 1 ? one : many, { n, ...vars });
}

export function setLang(next) {
  if (!LANGS[next] || next === lang) return;
  try { localStorage.setItem(KEY, next); } catch (_) { /* storage blocked */ }
  try { document.cookie = `freevis_lang=${next}; path=/; max-age=31536000; SameSite=Lax`; } catch (_) { /* no cookies */ }
  if (window.freevisDesktop?.setLanguage) window.freevisDesktop.setLanguage(next);
  location.reload();
}

const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip'];

/** Translate the static HTML (text nodes and a few attributes) in place. */
export function translatePage(root = document.body) {
  if (!dict) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.nodeValue.trim();
    if (s && dict[s]) n.nodeValue = n.nodeValue.replace(s, dict[s]);
  }
  for (const el of root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && dict[v.trim()]) el.setAttribute(a, dict[v.trim()]);
    }
  }
}
