// DMX tab: 512-channel grid for one universe with patch overlay and hover info.
import { channelLabel } from './profiles.js';
import { h } from './dom.js';
import { tr } from './i18n.js';

const COLS = 16;
const ROWS = 32;

export class DmxMonitor {
  constructor(app) {
    this.app = app;
    this.canvas = document.getElementById('dmxCanvas');
    this.select = document.getElementById('dmxUniverse');
    this.hoverEl = document.getElementById('dmxHover');
    this.inputsEl = document.getElementById('dmxInputs');
    this.universe = 1;
    this.hover = -1;
    this.select.addEventListener('change', () => { this.universe = Number(this.select.value); });
    this.canvas.addEventListener('mousemove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const col = Math.floor(((e.clientX - r.left) / r.width) * COLS);
      const row = Math.floor(((e.clientY - r.top) / r.height) * ROWS);
      this.hover = row * COLS + col;
    });
    this.canvas.addEventListener('mouseleave', () => { this.hover = -1; });
    this.refreshUniverses();
    setInterval(() => this.draw(), 100);
  }

  refreshUniverses() {
    const set = new Set(this.app.project.fixtures.map((f) => f.universe));
    for (const a of this.app.dmx.activeInputs.values()) set.add(a.display);
    if (!set.size) set.add(1);
    const list = [...set].sort((a, b) => a - b);
    const cur = this.universe;
    this.select.innerHTML = '';
    for (const u of list) this.select.append(h('option', { value: u }, tr('Univers {u}', { u })));
    this.universe = list.includes(cur) ? cur : list[0];
    this.select.value = this.universe;
  }

  _patchMap() {
    const map = new Array(512).fill(null);
    for (const f of this.app.project.fixtures) {
      if (f.universe !== this.universe) continue;
      const p = this.app.profile(f.profileId);
      p.channels.forEach((c, i) => {
        const idx = f.address - 1 + i;
        if (idx < 512) map[idx] = { f, c, i, first: i === 0, conflict: !!map[idx] };
      });
    }
    return map;
  }

  draw() {
    const tab = document.getElementById('tab-dmx');
    if (tab.classList.contains('hidden')) return;
    const known = [...this.app.dmx.activeInputs.values()].map((a) => a.display);
    if (known.some((u) => ![...this.select.options].some((o) => Number(o.value) === u))) this.refreshUniverses();

    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth * dpr;
    const H = cv.clientHeight * dpr;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d');
    const buf = this.app.dmx.get(this.universe);
    const map = this._patchMap();
    const cw = W / COLS;
    const ch = H / ROWS;
    g.fillStyle = '#07070a';
    g.fillRect(0, 0, W, H);
    g.font = `${Math.max(8, Math.floor(ch * 0.55))}px system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 512; i++) {
      const x = (i % COLS) * cw;
      const y = Math.floor(i / COLS) * ch;
      const v = buf ? buf[i] : 0;
      const m = map[i];
      g.fillStyle = m ? (m.conflict ? '#3a1018' : '#15131f') : '#0c0c10';
      g.fillRect(x + 1, y + 1, cw - 2, ch - 2);
      if (v) {
        g.fillStyle = `rgba(124,92,255,${0.25 + (v / 255) * 0.75})`;
        g.fillRect(x + 1, y + 1 + (ch - 2) * (1 - v / 255), cw - 2, (ch - 2) * (v / 255));
      }
      if (m && m.first) { g.fillStyle = '#a28bff'; g.fillRect(x + 1, y + 1, 2 * dpr, ch - 2); }
      if (i === this.hover) { g.strokeStyle = '#fff'; g.lineWidth = dpr; g.strokeRect(x + 1, y + 1, cw - 2, ch - 2); }
      g.fillStyle = v > 140 ? '#fff' : '#5c5c70';
      g.fillText(v ? String(v) : String(i + 1), x + cw / 2, y + ch / 2 + 1);
    }

    if (this.hover >= 0 && this.hover < 512) {
      const m = map[this.hover];
      const v = buf ? buf[this.hover] : 0;
      const where = m ? `${m.f.name} → ${channelLabel(m.c)} (ch ${m.i + 1})${m.conflict ? ` ${tr('⚠ suprapus')}` : ''}` : tr('nepatchuit');
      this.hoverEl.textContent = `${tr('Canal {ch} = {v}', { ch: this.hover + 1, v })} · ${where}`;
    }

    const now = Date.now();
    const inputs = [...this.app.dmx.activeInputs.values()].filter((a) => now - a.at < 5000);
    this.inputsEl.innerHTML = '';
    if (this.app.dmx.useDemo) this.inputsEl.append(h('div', {}, tr('● Demo intern activ (suprascrie intrarea live)')));
    if (!inputs.length) this.inputsEl.append(h('div', { class: 'muted' }, tr('Nicio intrare Art-Net/sACN în ultimele secunde.')));
    for (const a of inputs) {
      this.inputsEl.append(h('div', {}, tr('● {proto} univers {u} → afișat ca Univers {d}', { proto: a.protocol === 'artnet' ? 'Art-Net' : 'sACN', u: a.universe, d: a.display })));
    }
  }
}
