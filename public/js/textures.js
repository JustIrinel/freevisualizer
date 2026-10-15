// Procedural canvas textures (no image files): venue surfaces and fixture details.
import * as THREE from 'three';

const cache = new Map();

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

function texture(key, w, h, draw, { repeat = true, srgb = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const t = new THREE.CanvasTexture(canvas(w, h, draw));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

/** Copy of a cached texture with its own repeat. */
export function repeated(tex, rx, ry) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(rx, ry);
  return t;
}

function noise(g, w, h, alpha, rnd, size = 1) {
  for (let i = 0; i < (w * h) / (size * size * 6); i++) {
    const v = Math.floor(rnd() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(rnd() * w, rnd() * h, size, size);
  }
}

/** Oak parquet, planks along X. One tile ≈ 2 × 2 m. */
export function parquetTexture() {
  return texture('parquet', 1024, 1024, (g, w, h) => {
    const rnd = seeded(11);
    const rows = 16; // 12.5 cm planks
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 400;
      while (x < w) {
        const len = 260 + rnd() * 260;
        const base = 128 + rnd() * 40;
        const red = base + 34; const grn = base - 6; const blu = base - 58;
        const grd = g.createLinearGradient(x, 0, x + len, 0);
        grd.addColorStop(0, `rgb(${red},${grn},${blu})`);
        grd.addColorStop(1, `rgb(${red - 14},${grn - 14},${blu - 10})`);
        g.fillStyle = grd;
        g.fillRect(x, r * rh, len, rh);
        // grain lines
        for (let k = 0; k < 7; k++) {
          g.strokeStyle = `rgba(70,40,15,${0.08 + rnd() * 0.1})`;
          g.lineWidth = 1 + rnd() * 1.5;
          g.beginPath();
          const y0 = r * rh + rnd() * rh;
          g.moveTo(x, y0);
          g.bezierCurveTo(x + len * 0.3, y0 + (rnd() - 0.5) * 8, x + len * 0.6, y0 + (rnd() - 0.5) * 8, x + len, y0 + (rnd() - 0.5) * 6);
          g.stroke();
        }
        g.fillStyle = 'rgba(40,22,8,0.55)';
        g.fillRect(x, r * rh, 2, rh); // butt joint
        x += len;
      }
      g.fillStyle = 'rgba(40,22,8,0.5)';
      g.fillRect(0, r * rh, w, 2); // long joint
    }
    noise(g, w, h, 0.05, rnd, 2);
  });
}

/** Polished concrete / neutral floor. */
export function concreteTexture() {
  return texture('concrete', 512, 512, (g, w, h) => {
    const rnd = seeded(5);
    g.fillStyle = '#8c8a86';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const r = 20 + rnd() * 90; const x = rnd() * w; const y = rnd() * h;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const v = rnd() > 0.5 ? 255 : 0;
      grd.addColorStop(0, `rgba(${v},${v},${v},0.05)`);
      grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    noise(g, w, h, 0.08, rnd, 1);
  });
}

/** Painted plaster with a soft mottling. */
export function plasterTexture() {
  return texture('plaster', 512, 512, (g, w, h) => {
    const rnd = seeded(3);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const r = 30 + rnd() * 80; const x = rnd() * w; const y = rnd() * h;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(0,0,0,0.035)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    noise(g, w, h, 0.04, rnd, 1);
  });
}

/** Raised-panel wainscoting, one tile = 1 panel (≈ 1.2 m wide). White, tinted by the material colour. */
export function wainscotTexture() {
  return texture('wainscot', 256, 256, (g, w, h) => {
    g.fillStyle = '#e8e4dc';
    g.fillRect(0, 0, w, h);
    const m = 26;
    g.fillStyle = '#d6d0c4';
    g.fillRect(m, m, w - 2 * m, h - 2 * m);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 4;
    g.strokeRect(m + 2, m + 2, w - 2 * m - 4, h - 2 * m - 4);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(m, h - m); g.lineTo(w - m, h - m); g.lineTo(w - m, m);
    g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 0, 2, h);
  });
}

/** Vertical folds of a curtain (colour from the material). */
export function curtainTexture() {
  return texture('curtain', 512, 64, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const v = 0.72 + 0.28 * Math.sin((x / w) * Math.PI * 2 * 9) * Math.sin((x / w) * Math.PI * 2 * 2.3 + 1);
      const c = Math.round(255 * Math.max(0.35, v));
      g.fillStyle = `rgb(${c},${c},${c})`;
      g.fillRect(x, 0, 1, h);
    }
  });
}

/** Night window with mullions. */
export function windowTexture() {
  return texture('window', 256, 384, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#0d1830');
    grd.addColorStop(1, '#1c2a40');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    const rnd = seeded(9);
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(255,220,160,${0.2 + rnd() * 0.5})`; g.fillRect(rnd() * w, h * 0.55 + rnd() * h * 0.4, 3, 3); }
    g.fillStyle = '#e9e4da';
    const t = 12;
    g.fillRect(0, 0, w, t); g.fillRect(0, h - t, w, t); g.fillRect(0, 0, t, h); g.fillRect(w - t, 0, t, h);
    g.fillRect(w / 2 - t / 2, 0, t, h);
    g.fillRect(0, h * 0.33, w, t * 0.7); g.fillRect(0, h * 0.66, w, t * 0.7);
  }, { repeat: false });
}

/** Coffered ceiling tile (≈ 2 × 2 m). */
export function cofferTexture() {
  return texture('coffer', 256, 256, (g, w, h) => {
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, w, h);
    const m = 22;
    const grd = g.createLinearGradient(0, m, 0, h - m);
    grd.addColorStop(0, '#d9d4ca');
    grd.addColorStop(1, '#e7e3da');
    g.fillStyle = grd;
    g.fillRect(m, m, w - 2 * m, h - 2 * m);
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 3;
    g.strokeRect(m, m, w - 2 * m, h - 2 * m);
  });
}

/** Black ventilation grille (horizontal slots) for fixture housings. */
export function grilleTexture() {
  return texture('grille', 128, 128, (g, w, h) => {
    g.fillStyle = '#2b2c30';
    g.fillRect(0, 0, w, h);
    for (let y = 8; y < h - 4; y += 12) {
      g.fillStyle = '#050506';
      g.fillRect(10, y, w - 20, 6);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(10, y + 6, w - 20, 1);
    }
  });
}

/** Textured black plastic (roughness variation baked as colour noise). */
export function plasticTexture() {
  return texture('plastic', 256, 256, (g, w, h) => {
    const rnd = seeded(21);
    g.fillStyle = '#2a2b2f';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.12, rnd, 1);
  });
}

/** Small LCD with a DMX address, like the display on a fixture base. */
export function lcdTexture(text = 'A001') {
  return texture(`lcd-${text}`, 128, 48, (g, w, h) => {
    g.fillStyle = '#0a0d12';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#103a6a';
    g.fillRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#9fd4ff';
    g.font = 'bold 26px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 1);
  }, { repeat: false });
}

/** Round LED dots on black (for flat pars / washes), used as an alpha-like mask on emissive faces. */
export function ledDotsTexture(cols, rows) {
  return texture(`leds-${cols}x${rows}`, 256, 256, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const cw = w / cols; const ch = h / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = (i + 0.5) * cw; const y = (j + 0.5) * ch;
        const r = Math.min(cw, ch) * 0.36;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, '#fff');
        grd.addColorStop(0.55, '#ddd');
        grd.addColorStop(1, '#222');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, { repeat: false });
}

/** Concentric Fresnel rings for lenses. */
export function fresnelTexture() {
  return texture('fresnel', 256, 256, (g, w, h) => {
    const cx = w / 2;
    for (let r = cx; r > 0; r -= 6) {
      const v = 200 + ((r / 6) % 2) * 55;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      g.arc(cx, cx, r, 0, Math.PI * 2);
      g.fill();
    }
  }, { repeat: false });
}
