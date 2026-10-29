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

// ------------------------------------------------------------------ PBR sets (CC0 photos)
// Albedo / normal / roughness from public/textures/ (see CREDITS.md there). Each set shows
// a procedural stand-in right away and swaps in the photo texture when it has loaded; in
// Node (tests) or when a file is missing the stand-in stays. Roughness maps are scaled to
// 0.4–1, so the material's roughness stays the "average" value the room code sets.
const TEX_URL = new URL('../textures/', import.meta.url);
/** Metres covered by one texture tile (callers divide the surface size by this). */
export const PBR_TILE = { parquet: 2, plaster: 2.5, velvet: 1.2, metal: 0.5, carpet: 1, linen: 0.6, dancefloor: 1.2, wainscot: 1.2 };
const PBR_FILES = ['parquet', 'plaster', 'velvet', 'metal', 'carpet', 'linen'];
const pbrBase = new Map();

/** Flat stand-ins: neutral normal (128,128,255), roughness 1 (white), mid-grey albedo. */
function flat(key, rgb) {
  return texture(`flat-${key}`, 4, 4, (g, w, h) => { g.fillStyle = rgb; g.fillRect(0, 0, w, h); }, { srgb: false });
}

/** Normal map (OpenGL convention) from a height canvas drawn by `draw`. */
function normalFromHeight(key, size, strength, draw) {
  return texture(`n-${key}`, size, size, (g, w, h) => {
    draw(g, w, h);
    if (typeof window === 'undefined') return;
    const src = g.getImageData(0, 0, w, h);
    const out = g.createImageData(w, h);
    const H = (x, y) => src.data[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
        const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
        const l = Math.hypot(dx, dy, 1);
        const i = (y * w + x) * 4;
        out.data[i] = (-dx / l * 0.5 + 0.5) * 255;
        out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; // +Y up in the image = OpenGL normal maps
        out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
        out.data[i + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
  }, { srgb: false });
}

/** Black dance-floor panels (2 × 2 per tile): high gloss, dark grooves, faint scuffs. */
function danceFloorSet() {
  const n = 2;
  const groove = (g, w, h, colour, bg) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = colour;
    for (let i = 0; i <= n; i++) { const p = (i / n) * w; g.fillRect(p - 2, 0, 4, h); g.fillRect(0, p - 2, w, 4); }
  };
  return {
    map: texture('dance-albedo', 512, 512, (g, w, h) => {
      const rnd = seeded(31);
      groove(g, w, h, '#020203', '#0d0d10');
      for (let i = 0; i < n * n; i++) { // panels differ a touch
        const v = 12 + Math.floor(rnd() * 5);
        g.fillStyle = `rgba(${v},${v},${v + 2},0.5)`;
        g.fillRect((i % n) * (w / n) + 3, Math.floor(i / n) * (h / n) + 3, w / n - 6, h / n - 6);
      }
      noise(g, w, h, 0.03, rnd, 1);
    }),
    normalMap: normalFromHeight('dance', 512, 6, (g, w, h) => {
      groove(g, w, h, '#000', '#fff');
      g.filter = 'blur(1.5px)';
      g.drawImage(g.canvas, 0, 0);
      g.filter = 'none';
    }),
    roughnessMap: texture('dance-rough', 512, 512, (g, w, h) => {
      const rnd = seeded(41);
      groove(g, w, h, '#ffffff', '#7a7a7a');
      // Scuffs and dance marks: rougher swirls.
      for (let i = 0; i < 160; i++) {
        g.strokeStyle = `rgba(255,255,255,${0.04 + rnd() * 0.08})`;
        g.lineWidth = 1 + rnd() * 3;
        g.beginPath();
        const x = rnd() * w; const y = rnd() * h; const r = 10 + rnd() * 60;
        g.arc(x, y, r, rnd() * 6, rnd() * 6 + 1.5);
        g.stroke();
      }
    }, { srgb: false }),
  };
}

/** Raised-panel wainscoting: the panel texture plus a normal map of its mouldings. */
function wainscotSet() {
  return {
    map: wainscotTexture(),
    normalMap: normalFromHeight('wainscot', 256, 5, (g, w, h) => {
      const m = 26;
      g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c0c0c0'; g.fillRect(m, m, w - 2 * m, h - 2 * m); // raised field
      g.strokeStyle = '#404040'; g.lineWidth = 6; g.strokeRect(m - 3, m - 3, w - 2 * m + 6, h - 2 * m + 6); // groove
      g.fillStyle = '#505050'; g.fillRect(0, 0, 3, h); // panel joint
      g.filter = 'blur(2px)';
      g.drawImage(g.canvas, 0, 0);
      g.filter = 'none';
    }),
  };
}

const STAND_INS = {
  parquet: () => ({ map: parquetTexture() }),
  plaster: () => ({ map: plasterTexture() }),
  velvet: () => ({ map: curtainTexture() }),
  dancefloor: danceFloorSet,
  wainscot: wainscotSet,
};

function loadInto(tex, file, base) {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.createElementNS) return;
  base.pending++;
  const done = () => { if (--base.pending === 0) base.clones = []; };
  new THREE.ImageLoader().load(new URL(file, TEX_URL).href, (img) => {
    tex.image = img; // the clones share the source, so they get the photo too
    tex.needsUpdate = true;
    for (const c of base.clones) c.needsUpdate = true;
    done();
  }, undefined, () => done()); // missing file: keep the stand-in
}

function pbrBaseSet(name) {
  if (pbrBase.has(name)) return pbrBase.get(name);
  const stand = (STAND_INS[name] || (() => ({})))();
  const base = { clones: [], textures: {}, pending: 0 };
  // Own source: loading the photo must not replace the procedural texture used elsewhere.
  const own = (t, srgb) => { const c = t.clone(); c.source = new THREE.Source(t.image); c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.anisotropy = 8; c.needsUpdate = true; return c; };
  if (PBR_FILES.includes(name)) {
    base.textures.map = own(stand.map || flat('albedo', '#bdbdbd'), true);
    base.textures.normalMap = own(stand.normalMap || flat('normal', 'rgb(128,128,255)'), false);
    base.textures.roughnessMap = own(stand.roughnessMap || flat('rough', '#ffffff'), false);
    loadInto(base.textures.map, `${name}_albedo.jpg`, base);
    loadInto(base.textures.normalMap, `${name}_normal.jpg`, base);
    loadInto(base.textures.roughnessMap, `${name}_rough.jpg`, base);
  } else {
    for (const [k, t] of Object.entries(stand)) base.textures[k] = own(t, k === 'map');
  }
  pbrBase.set(name, base);
  return base;
}

/**
 * PBR texture set for a material: { map, normalMap, roughnessMap } (only the maps the set has),
 * each with its own repeat. Spread it into a MeshStandardMaterial: `{ color, ...pbrSet('parquet', 8, 6) }`.
 * Names: parquet, plaster, velvet, metal, carpet, linen (photo textures) and dancefloor, wainscot (procedural).
 */
export function pbrSet(name, repeatX = 1, repeatY = 1) {
  const base = pbrBaseSet(name);
  const out = {};
  for (const [k, t] of Object.entries(base.textures)) {
    const c = t.clone();
    c.repeat.set(repeatX, repeatY);
    c.needsUpdate = true;
    if (base.pending) base.clones.push(c); // still loading: refresh when the photo arrives
    out[k] = c;
  }
  return out;
}
