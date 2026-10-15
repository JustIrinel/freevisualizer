// Records the 3D show as a video clip (MP4 when the browser supports it, WebM
// otherwise) with the DJ's logo and text on top and optional music.
import { h, openModal, toast, numberInput, field } from './dom.js';
import { tr } from './i18n.js';

const BRAND_KEY = 'freevis.brand.v1';

export const FORMATS = {
  vertical: { label: tr('Vertical 9:16 (Reels, TikTok, Stories)'), size: [1080, 1920] },
  landscape: { label: tr('Orizontal 16:9 (YouTube, ofertă, WhatsApp)'), size: [1920, 1080] },
  square: { label: tr('Pătrat 1:1 (postare Instagram)'), size: [1080, 1080] },
};

export function loadBrand() {
  try {
    return { text: 'DJ Matei', subtitle: 'djmatei.ro', logo: null, ...JSON.parse(localStorage.getItem(BRAND_KEY) || '{}') };
  } catch (_) {
    return { text: 'DJ Matei', subtitle: 'djmatei.ro', logo: null };
  }
}

export function saveBrand(brand) {
  try { localStorage.setItem(BRAND_KEY, JSON.stringify(brand)); } catch (_) { toast(tr('Logo-ul este prea mare pentru a fi salvat.'), 'error'); }
}

/** Best container/codec this browser can record: H.264 MP4 first (plays everywhere). */
export function pickMimeType(withAudio = false) {
  const candidates = withAudio ? [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,opus', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
  ] : [
    ['video/mp4;codecs=avc1.640028', 'mp4'],
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm', 'webm'],
  ];
  if (typeof MediaRecorder === 'undefined') return null;
  for (const [type, ext] of candidates) if (MediaRecorder.isTypeSupported(type)) return { type, ext };
  return null;
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Draw `src` into the whole of `ctx` (cover). */
function drawCover(ctx, src, W, H) {
  const sw = src.width; const sh = src.height;
  const scale = Math.max(W / sw, H / sh);
  const dw = sw * scale; const dh = sh * scale;
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function drawOverlay(ctx, W, H, brand, logo, extra) {
  const unit = Math.min(W, H);
  const pad = unit * 0.05;
  // Soft gradient so the text reads on bright scenes.
  const g = ctx.createLinearGradient(0, H * 0.72, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.72, W, H * 0.28);

  let x = pad;
  const baseY = H - pad;
  if (logo) {
    const lh = unit * 0.13;
    const lw = (logo.width / logo.height) * lh;
    ctx.drawImage(logo, x, baseY - lh, lw, lh);
    x += lw + unit * 0.03;
  }
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = unit * 0.012;
  const lines = [brand.text, [brand.subtitle, extra].filter(Boolean).join(' · ')].filter(Boolean);
  if (lines.length === 2) {
    ctx.font = `700 ${Math.round(unit * 0.055)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(lines[0], x, baseY - unit * 0.045);
    ctx.font = `500 ${Math.round(unit * 0.032)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(lines[1], x, baseY);
    ctx.globalAlpha = 1;
  } else if (lines.length === 1) {
    ctx.font = `700 ${Math.round(unit * 0.055)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(lines[0], x, baseY);
  }
  ctx.shadowBlur = 0;
}

/** Smooth camera move: a slow orbit around the current target with a gentle push-in. */
function cinematicPath(vis, duration) {
  const cam = vis.getCamera();
  const [tx, ty, tz] = cam.target;
  const dx = cam.position[0] - tx; const dz = cam.position[2] - tz;
  const radius = Math.max(4, Math.hypot(dx, dz));
  const startAngle = Math.atan2(dx, dz);
  const startY = cam.position[1];
  return (t) => {
    const k = Math.min(1, t / duration);
    const e = k * k * (3 - 2 * k);
    const angle = startAngle - 0.9 + e * 1.8;
    const r = radius * (1.05 - 0.2 * e);
    vis.setCamera({ position: [tx + Math.sin(angle) * r, startY + 0.6 - 0.9 * e, tz + Math.cos(angle) * r], target: [tx, ty, tz] });
  };
}

export class ClipRecorder {
  constructor(app) {
    this.app = app;
    this.active = false;
  }

  async start(opts) {
    const app = this.app;
    const vis = app.vis;
    const mime = pickMimeType(!!opts.music);
    if (!mime) { toast(tr('Browserul nu poate înregistra video. Folosește aplicația FreeVisualizer, Chrome sau Edge.'), 'error', 6000); return; }
    const [W, H] = FORMATS[opts.format].size.map((v) => Math.round(v * opts.scale));
    const brand = loadBrand();
    const logo = await loadImage(brand.logo);

    // Recording canvas = 3D render + overlay.
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(opts.fps);

    let audio = null; let audioCtx = null;
    if (opts.music) {
      audio = new Audio(URL.createObjectURL(opts.music));
      audio.crossOrigin = 'anonymous';
      audioCtx = new AudioContext();
      const src = audioCtx.createMediaElementSource(audio);
      const dest = audioCtx.createMediaStreamDestination();
      src.connect(dest);
      src.connect(audioCtx.destination);
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    }

    const recorder = new MediaRecorder(stream, { mimeType: mime.type, videoBitsPerSecond: opts.bitrate });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    // Prepare the scene: fixed resolution, no gizmos/labels, demo if asked.
    const prev = { selected: [...app.selectedIds], labels: vis.settings.showLabels, demo: app.dmx.useDemo, bpm: app.demoBpm, camera: vis.getCamera(), fov: vis.camera.fov };
    // Narrow formats need a wider lens to show the same room.
    vis.camera.fov = opts.format === 'vertical' ? 72 : opts.format === 'square' ? 60 : prev.fov;
    app.select(null);
    vis.settings.showLabels = false;
    vis.applySettings();
    vis.setRenderSize([W, H]);
    document.body.classList.add('recording');
    if (opts.demo) { app.demoBpm = opts.bpm; app.toggleDemo(true); }
    const camPath = opts.camera === 'cinematic' ? cinematicPath(vis, opts.duration) : null;

    this.active = true;
    let elapsed = 0;
    vis.onAfterRender = (dt) => {
      elapsed += dt;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      drawCover(ctx, vis.renderer.domElement, W, H);
      if (opts.overlay) drawOverlay(ctx, W, H, brand, logo, opts.caption);
    };
    const tick = () => {
      if (!this.active) return;
      const t = (performance.now() - started) / 1000;
      if (camPath) camPath(t);
      this._updateBadge(Math.max(0, opts.duration - t));
      if (t >= opts.duration) { this.stop(); return; }
      requestAnimationFrame(tick);
    };

    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    this._stopAll = () => {
      vis.onAfterRender = null;
      if (recorder.state !== 'inactive') recorder.stop();
      if (audio) audio.pause();
    };
    this._showBadge();
    recorder.start(1000);
    if (audio) { audio.currentTime = 0; await audio.play().catch(() => {}); }
    const started = performance.now();
    requestAnimationFrame(tick);

    await done;
    // Restore everything.
    vis.camera.fov = prev.fov;
    vis.setRenderSize(null);
    document.body.classList.remove('recording');
    vis.settings.showLabels = prev.labels;
    vis.applySettings();
    if (opts.demo) { app.demoBpm = prev.bpm; app.toggleDemo(prev.demo); }
    if (camPath) vis.setCamera(prev.camera);
    app.setSelection(prev.selected);
    if (audioCtx) audioCtx.close();
    this._hideBadge();

    const blob = new Blob(chunks, { type: mime.type.split(';')[0] });
    if (!blob.size) { toast(tr('Înregistrarea a eșuat (fișier gol).'), 'error'); return; }
    const name = `${(app.project.name || 'show').replace(/[^\p{L}\p{N} _.-]/gu, '').trim() || 'show'} – clip ${opts.format === 'vertical' ? '9x16' : opts.format === 'square' ? '1x1' : '16x9'}.${mime.ext}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast(tr('Clip salvat: {file} ({mb} MB)', { file: name, mb: (blob.size / 1048576).toFixed(1) }), 'info', 6000);
    this.lastBlob = blob;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    if (this._stopAll) this._stopAll();
  }

  _showBadge() {
    let b = document.getElementById('recBadge');
    if (!b) {
      b = h('div', { id: 'recBadge', class: 'rec-badge' }, h('span', { class: 'dot' }), h('span', { class: 'txt' }, 'REC'),
        h('button', { onclick: () => this.stop() }, tr('Oprește')));
      document.body.appendChild(b);
    }
    b.classList.remove('hidden');
  }

  _updateBadge(left) {
    const b = document.getElementById('recBadge');
    if (b) b.querySelector('.txt').textContent = `REC ${Math.ceil(left)}s`;
  }

  _hideBadge() {
    const b = document.getElementById('recBadge');
    if (b) b.classList.add('hidden');
  }
}

/** Dialog with format, duration, camera, music and branding options. */
export async function recordDialog(app) {
  if (app.recorder.active) { app.recorder.stop(); return; }
  const mime = pickMimeType();
  const st = {
    format: 'vertical', duration: 30, camera: 'cinematic', overlay: true, demo: !app.dmx.receiving, bpm: app.demoBpm || 126,
    music: null, caption: app.project.name && !/^Rig |^Proiect nou/.test(app.project.name) && ![tr('Proiect nou'), tr('Rig demo – nuntă / club'), tr('Rig nuntă – sală de evenimente')].includes(app.project.name) ? app.project.name : '', scale: 1, fps: 30,
  };
  const select = (value, options, onChange) => {
    const el = h('select', {}, Object.entries(options).map(([k, v]) => h('option', { value: k }, v)));
    el.value = value;
    el.addEventListener('change', () => onChange(el.value));
    return el;
  };
  const musicInput = h('input', { type: 'file', accept: 'audio/*' });
  musicInput.addEventListener('change', () => { st.music = musicInput.files[0] || null; });
  const caption = h('input', { value: st.caption, placeholder: tr('ex: Nuntă Ana & Mihai · Salon Diamond') });
  caption.addEventListener('input', () => { st.caption = caption.value.trim(); });
  const brand = loadBrand();

  const content = h('div', { class: 'form' },
    !mime ? h('div', { class: 'warn-box' }, tr('Acest browser nu poate înregistra video. Folosește aplicația FreeVisualizer, Chrome sau Edge.')) : null,
    h('div', { class: 'grid2' },
      field(tr('Format'), select(st.format, Object.fromEntries(Object.entries(FORMATS).map(([k, v]) => [k, v.label])), (v) => { st.format = v; })),
      field(tr('Durată'), select(String(st.duration), { 15: tr('{n} secunde', { n: 15 }), 30: tr('{n} secunde', { n: 30 }), 60: tr('{n} secunde', { n: 60 }) }, (v) => { st.duration = Number(v); }))),
    h('div', { class: 'grid2' },
      field(tr('Cameră'), select(st.camera, { cinematic: tr('Mișcare cinematică automată'), fixed: tr('Fixă / o mișc eu') }, (v) => { st.camera = v; })),
      field(tr('Calitate'), select('1', { 1: tr('Full HD (recomandat)'), 0.6667: tr('HD 720p (laptop mai slab)') }, (v) => { st.scale = Number(v); }))),
    field(tr('Text sub logo (opțional)'), caption),
    field(tr('Muzică (opțional, fișier audio)'), musicInput),
    h('div', { class: 'grid2' },
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: st.demo, onchange: (e) => { st.demo = e.target.checked; } }), tr('Folosește show-ul Demo')),
      field(tr('BPM pentru demo'), numberInput(st.bpm, (v) => { st.bpm = v; }, { min: 60, max: 200, integer: true }))),
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: st.overlay, onchange: (e) => { st.overlay = e.target.checked; } }), tr('Logo și text: „{text}”', { text: `${brand.text}${brand.subtitle ? ' · ' + brand.subtitle : ''}` })),
    h('div', { class: 'muted small' }, tr('Logo-ul și textul le schimbi din ⚙ Setări → Branding. Cu SoundSwitch pornit, debifează Demo ca să înregistrezi show-ul real pe melodia care rulează.')),
    mime ? h('div', { class: 'muted small' }, tr('Fișierul va fi salvat ca .{ext}.', { ext: mime.ext })) : null,
  );
  const res = await openModal(tr('● Înregistrează clip video'), content, [
    { label: tr('Anulează'), value: null },
    { label: tr('● Pornește înregistrarea'), primary: true, value: 'go' },
  ]);
  if (res !== 'go' || !mime) return;
  await app.recorder.start({ ...st, bitrate: st.scale < 1 ? 8e6 : 14e6 });
}
