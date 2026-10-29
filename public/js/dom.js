// Tiny DOM helpers (no framework).
import { tr } from './i18n.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer = null;
export function toast(msg, type = 'info', ms = 3200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/**
 * Opens the shared <dialog>. `content` is a node; `buttons` = [{ label, primary, value, onClick }].
 * Resolves with the clicked button's value (or null when dismissed).
 * A button's onClick may return false to keep the dialog open.
 */
export function openModal(title, content, buttons = [{ label: tr('Închide'), value: null }], opts = {}) {
  const dlg = document.getElementById('modal');
  const body = document.getElementById('modalBody');
  body.innerHTML = '';
  dlg.style.width = opts.width || '';
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      dlg.close();
      resolve(v);
    };
    const foot = h('div', { class: 'modal-foot' }, buttons.map((b) => h('button', {
      class: b.primary ? 'primary' : b.danger ? 'danger' : '',
      onclick: async () => {
        if (b.onClick) {
          const r = await b.onClick();
          if (r === false) return;
        }
        finish(b.value);
      },
    }, b.label)));
    body.append(
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon', onclick: () => finish(null), title: tr('Închide') }, '✕')),
      h('div', { class: 'modal-content' }, content),
      foot,
    );
    // Ignore a late 'close' event from a previous dialog when this one is already open.
    dlg.onclose = () => { if (!dlg.open) finish(null); };
    dlg.showModal();
  });
}

export function closeModal() {
  const dlg = document.getElementById('modal');
  if (dlg.open) dlg.close();
}

export function numberInput(value, onChange, opts = {}) {
  const el = h('input', { type: 'number', value, step: opts.step ?? 1, min: opts.min, max: opts.max });
  el.addEventListener('change', () => {
    let v = parseFloat(el.value);
    if (Number.isNaN(v)) v = opts.fallback ?? 0;
    if (opts.min != null) v = Math.max(opts.min, v);
    if (opts.max != null) v = Math.min(opts.max, v);
    if (opts.integer) v = Math.round(v);
    el.value = v;
    onChange(v);
  });
  return el;
}

export function field(label, input, title) {
  return h('label', { title }, label, input);
}

export function pickFile(accept = '.json') {
  return new Promise((resolve) => {
    const input = document.getElementById('fileInput');
    input.accept = accept;
    input.value = '';
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

/** File name without diacritics or symbols some browsers refuse in downloads ("Nuntă – clip" → "Nunta - clip"). */
export function safeFileName(name, fallback = 'freevisualizer') {
  const s = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—]/g, '-')
    .replace(/[^A-Za-z0-9 _.()-]/g, '').replace(/\s+/g, ' ').trim();
  return s || fallback;
}

export function rgbCss(rgb, k = 1) {
  return `rgb(${Math.round(Math.min(1, rgb[0] * k) * 255)},${Math.round(Math.min(1, rgb[1] * k) * 255)},${Math.round(Math.min(1, rgb[2] * k) * 255)})`;
}
