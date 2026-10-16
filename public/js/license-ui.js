// Licence in the page: trial badge in the top bar, the "Licență" screen and the
// "not activated" watermark. The real check is in the desktop app's server
// (server/license.js): in limited mode it stops passing live DMX on.
import { h, openModal, toast } from './dom.js';
import { tr } from './i18n.js';

const LIMITED_OFF = ['dmx', 'clips', 'present'];

export class LicenseUI {
  constructor(app) {
    this.app = app;
    this.state = { status: 'active', dev: true };
    this.badge = document.getElementById('licenseBadge');
    this.badge?.addEventListener('click', () => this.open());
    this.watermark = h('div', { class: 'license-watermark hidden' }, tr('FreeVisualizer – neactivat'));
    document.getElementById('viewport')?.appendChild(this.watermark);
    // Secret shortcut for DJ Matei's license generator (desktop app only).
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.altKey && e.code === 'KeyL') {
        e.preventDefault();
        window.freevisDesktop?.openLicenseAdmin?.();
      }
    });
    this.refresh();
    setInterval(() => this.refresh(), 60000);
  }

  async refresh() {
    try {
      this.state = await (await fetch('/api/license')).json();
    } catch (_) { /* offline: keep the last state */ }
    this.render();
    return this.state;
  }

  allows(feature) {
    return this.state.status !== 'limited' || !LIMITED_OFF.includes(feature);
  }

  /** Run `fn` when the feature is allowed, otherwise show the licence screen. */
  guard(feature, fn) {
    if (this.allows(feature)) return fn();
    toast(tr('Perioada de probă s-a terminat. Activează FreeVisualizer ca să folosești din nou această funcție.'), 'error', 5000);
    return this.open();
  }

  render() {
    const s = this.state;
    const b = this.badge;
    if (b) {
      b.classList.toggle('hidden', s.status === 'active');
      b.classList.toggle('limited', s.status === 'limited');
      b.textContent = s.status === 'trial'
        ? tr('Probă: {h} h rămase · Activează', { h: s.hoursLeft })
        : tr('🔒 Neactivat · Deblochează');
    }
    this.watermark.classList.toggle('hidden', s.status !== 'limited');
  }

  async open() {
    const s = await this.refresh();
    const cfg = s.config || {};
    const price = cfg.price || '10$';
    const status = s.status === 'active'
      ? h('div', { class: 'license-status ok' }, s.dev ? tr('Versiune de dezvoltare – fără limite.') : tr('✅ Activat pe acest calculator · {name} ({lic})', { name: s.licensee || '', lic: s.license || '' }))
      : s.status === 'trial'
        ? h('div', { class: 'license-status' }, tr('Perioadă de probă gratuită: mai ai {h} h cu toate funcțiile.', { h: s.hoursLeft }))
        : h('div', { class: 'license-status bad' }, s.reason === 'clock'
          ? tr('Ora calculatorului a fost dată înapoi, așa că perioada de probă s-a încheiat.')
          : tr('Perioada de probă de 24 h s-a terminat. Proiectele și editarea merg în continuare; DMX-ul live, clipurile și fereastra de prezentare cer activarea.'));
    if (s.status === 'active') {
      await openModal(tr('Licență FreeVisualizer'), h('div', { class: 'form license' }, status), [{ label: tr('Gata'), primary: true, value: true }]);
      return;
    }
    const code = h('input', { class: 'license-code', value: s.device || '', readonly: true });
    const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast(tr('Copiat.'))).catch(() => { code.select(); document.execCommand('copy'); });
    const message = tr('Salut! Am plătit licența FreeVisualizer ({price}). Codul calculatorului meu: {code}', { price, code: s.device });
    const payLinks = [
      cfg.paypal ? h('a', { class: 'btn primary', href: paypalLink(cfg.paypal, price), target: '_blank', rel: 'noopener' }, tr('Plătește {price} cu PayPal', { price })) : null,
      cfg.revolut ? h('a', { class: 'btn primary', href: cfg.revolut, target: '_blank', rel: 'noopener' }, tr('Plătește {price} cu Revolut', { price })) : null,
    ].filter(Boolean);
    const sendLinks = [
      cfg.whatsapp ? h('a', { class: 'btn', href: `https://wa.me/${String(cfg.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, target: '_blank', rel: 'noopener' }, tr('Trimite codul pe WhatsApp')) : null,
      cfg.email ? h('a', { class: 'btn', href: `mailto:${cfg.email}?subject=${encodeURIComponent(tr('Licență FreeVisualizer'))}&body=${encodeURIComponent(message)}`, target: '_blank', rel: 'noopener' }, tr('Trimite codul pe email')) : null,
    ].filter(Boolean);
    const keyInput = h('textarea', { class: 'license-key', placeholder: 'FVL1.…', rows: 3, spellcheck: 'false' });
    keyInput.addEventListener('keydown', (e) => e.stopPropagation());
    const msg = h('div', { class: 'small' });
    const content = h('div', { class: 'form license' },
      status,
      h('div', { class: 'license-offer' },
        h('b', {}, tr('Deblocare completă: {price}, o singură plată', { price })),
        h('ul', {},
          h('li', {}, tr('DMX live din SoundSwitch (Art-Net / sACN), fără limită de timp')),
          h('li', {}, tr('Clipuri video cu logo-ul tău și fereastra de prezentare')),
          h('li', {}, tr('Pe până la 2 calculatoare (de ex. laptopul de evenimente și cel de acasă)')),
          h('li', {}, tr('Toate actualizările din versiunea 1.x')))),
      h('h4', {}, tr('1. Plătește')),
      payLinks.length ? h('div', { class: 'row' }, payLinks) : h('div', { class: 'muted small' }, tr('Linkurile de plată apar aici în curând.')),
      h('h4', {}, tr('2. Trimite codul acestui calculator')),
      h('div', { class: 'row' }, code, h('button', { onclick: () => copy(s.device) }, tr('📋 Copiază'))),
      sendLinks.length ? h('div', { class: 'row' }, sendLinks) : null,
      h('div', { class: 'muted small' }, tr('Primești înapoi o cheie de licență, de obicei în aceeași zi.')),
      h('h4', {}, tr('3. Lipește cheia primită')),
      keyInput,
      msg,
      s.canActivate === false ? h('div', { class: 'warn-box small' }, tr('Activarea cu cheie va fi disponibilă în următoarea actualizare.')) : null);
    await openModal(tr('Activează FreeVisualizer'), content, [
      { label: tr('Mai târziu'), value: null },
      {
        label: tr('Activează'),
        primary: true,
        onClick: async () => {
          const key = keyInput.value.trim();
          if (!key) { msg.textContent = tr('Lipește întâi cheia primită.'); msg.className = 'small error-text'; return false; }
          const res = await fetch('/api/license', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            msg.textContent = {
              device: tr('Cheia e pentru alt calculator. Verifică dacă ai trimis codul acestui calculator.'),
              signature: tr('Cheia nu e validă. Copiaz-o din nou, întreagă.'),
              format: tr('Cheia nu e completă sau nu are formatul corect (începe cu FVL1.).'),
              nokey: tr('Activarea cu cheie va fi disponibilă în următoarea actualizare.'),
            }[data.error] || tr('Cheia nu a putut fi verificată.');
            msg.className = 'small error-text';
            return false;
          }
          this.state = data;
          this.render();
          toast(tr('✅ FreeVisualizer e activat. Mulțumesc!'), 'info', 5000);
          return true;
        },
      },
    ], { width: '620px' });
  }
}

/** paypal.me/name → paypal.me/name/10USD so the amount is filled in. */
function paypalLink(link, price) {
  const amount = String(price).replace(/[^\d.]/g, '');
  if (/paypal\.me\/[^/]+\/?$/i.test(link) && amount) return `${link.replace(/\/$/, '')}/${amount}USD`;
  return link;
}
