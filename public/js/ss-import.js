// SoundSwitch project (.ssproj) → FreeVisualizer.
//
// A .ssproj is a folder; the patch lives in SoundSwitchVenues.bin, a binary
// archive (little endian, strings = u32 1 + u32 length incl. NUL + UTF-16LE).
// The layout below was worked out from a real SoundSwitch 2.11 project:
//
//   fixture definition   tag 0x8000000x, u32 0, u32 14, str name, str manufacturer,
//                        u32, GUID(16), … colour wheels …, modes
//   colour wheel         str name, u32 slots, slot × range record
//   mode                 u32 4, u32 cells, cell × { u32 3, u32 5, u32 attrs,
//                        attr × attribute, str cell name, u8 },
//                        u32 items, item × { u32 2, u32 0, str }, u32 channels, str name
//   attribute            u32 2, u32 type, str name, u32 1, u32 1, u16 0,
//                        u32 bytes, u32 offset, u32 fine offset, tail (depends on type)
//   range record         u32 4, u16 from, u16 to, str name, u32 hasColour,
//                        [u32 BGRA], u32 kind, u8
//   fixture (patch)      tag, u32 2, u32 5, str "Fixture n", …, GUID of its
//                        definition, u8, u32 mode index, u32 DMX address (0-based)
//   names                a list in fixture order holds each fixture's id in the
//                        group tree (the left panel of SoundSwitch), where the
//                        names typed by the user are.
import { DEFAULT_STROBE_RANGES, goboRanges } from './profiles.js';
import { tr } from './i18n.js';

class Reader {
  constructor(buffer) {
    this.b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.v = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
    this.n = this.b.length;
    this.dec = new TextDecoder('utf-16le');
  }

  u32(i) { return i >= 0 && i + 4 <= this.n ? this.v.getUint32(i, true) : -1; }
  u16(i) { return i >= 0 && i + 2 <= this.n ? this.v.getUint16(i, true) : -1; }

  /** Flagged string at i → { s, end } or null. */
  str(i, maxLen = 1024) {
    if (this.u32(i) !== 1) return null;
    const len = this.u32(i + 4);
    if (len < 1 || len > maxLen) return null;
    const end = i + 8 + len * 2;
    if (end > this.n || this.b[end - 1] !== 0 || this.b[end - 2] !== 0) return null;
    const s = this.dec.decode(this.b.subarray(i + 8, end - 2));
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(s)) return null;
    return { s, end };
  }

  guid(i) {
    return Array.from(this.b.subarray(i, i + 16), (x) => x.toString(16).padStart(2, '0')).join('');
  }

  bytesEqual(i, arr) {
    for (let k = 0; k < arr.length; k++) if (this.b[i + k] !== arr[k]) return false;
    return true;
  }
}

const NORMAL_TAIL = [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0];
const HEAD_FLAGS = [1, 0, 0, 0, 1, 0, 0, 0, 0, 0];

// SoundSwitch attribute types seen in projects.
const TYPE = {
  1: 'dimmer', 2: 'colorWheel', 3: 'pan', 4: 'tilt', 7: 'prism', 8: 'gobo',
  14: 'red', 15: 'green', 16: 'blue', 87: 'white', 41: 'strobe', 60: 'fog',
};
// 26 = "Gobo Rotation" in SoundSwitch projects (ranges are not stored).
const ROTATION_TYPE = 26;
// Types that are known to have no visual effect (speed, reset, programs…).
const NO_VISUAL = new Set([17, 20, 82, 83, 84, 88]);
// SoundSwitch does not store the rotation ranges: common layout (0–7 stop, CW, CCW).
const SS_ROTATION = [{ from: 0, to: 7, stop: true }, { from: 8, to: 127, rotate: 1 }, { from: 128, to: 247, rotate: -1 }, { from: 248, to: 255, stop: true }];
const FINE = { dimmer: 'dimmerFine', pan: 'panFine', tilt: 'tiltFine' };

/** Intimidator Spot LED 250 gobo wheel: open + 7 gobos (8 values each), shake 7 → 1, open, scroll CW / CCW. */
function intimidator250Gobos() {
  const out = [];
  for (let g = 0; g < 8; g++) out.push({ from: g * 8, to: g * 8 + 7, gobo: g });
  for (let g = 7; g >= 1; g--) out.push({ from: 64 + (7 - g) * 8, to: 71 + (7 - g) * 8, gobo: g, shake: true });
  out.push({ from: 120, to: 127, gobo: 0 }, { from: 128, to: 191, gobo: 1, rotate: true }, { from: 192, to: 255, gobo: 1, rotate: true });
  return out;
}

// SoundSwitch definitions keep no ranges for gobo / prism, and some leave channels out.
// Fixtures of this rig whose real layout is known (manual + the values of the user's
// SoundSwitch presets, e.g. gobos at 10, 17, 24, 34, 41, 52, 62, prism at 72 / 141 / 183).
const KNOWN = [
  {
    match: /^chauvet\|intimidator spot led 250$/i,
    ranges: { gobo: intimidator250Gobos, prism: () => [{ from: 0, to: 15, prism: 0 }, { from: 16, to: 255, prism: 3 }] },
  },
  {
    // UKing 7-ch pars: ch 5 is strobe (0–10 off). SoundSwitch's definition leaves it out,
    // so SoundSwitch sends 0 there (no strobe); other controllers may use it.
    match: /^uking\|zq01104$/i,
    missing: { 7: { 4: () => ({ type: 'strobe', label: 'Strobe', ranges: [{ from: 0, to: 10, mode: 'open' }, { from: 11, to: 255, mode: 'strobe', hzFrom: 1, hzTo: 20 }] }) } },
  },
];
const knownOf = (def) => KNOWN.find((k) => k.match.test(`${def.manufacturer}|${def.name}`.trim())) || {};
const COLOR_TYPES = new Set(['red', 'green', 'blue', 'white', 'amber', 'uv', 'lime', 'cyan', 'magenta', 'yellow', 'warmWhite', 'coldWhite']);

function typeByName(name) {
  const n = name.toLowerCase();
  const rules = [
    [/warm ?white/, 'warmWhite'], [/(cold|cool) ?white/, 'coldWhite'], [/amber/, 'amber'], [/\buv\b|ultra ?violet/, 'uv'],
    [/lime/, 'lime'], [/cyan/, 'cyan'], [/magenta/, 'magenta'], [/yellow/, 'yellow'], [/zoom/, 'zoom'], [/frost/, 'frost'],
    [/fog|smoke|haze/, 'fog'], [/^(dimmer|intensity|master dimmer)$/, 'dimmer'], [/^red$/, 'red'], [/^green$/, 'green'],
    [/^blue$/, 'blue'], [/^white$/, 'white'], [/^pan$/, 'pan'], [/^tilt$/, 'tilt'], [/shutter|strobe/, 'strobe'],
  ];
  for (const [re, t] of rules) if (re.test(n)) return t;
  return 'none';
}

/** Range record: values, colour (for wheels) and kind. */
function readRange(r, p) {
  if (r.u32(p) !== 4) return null;
  const from = r.u16(p + 4); const to = r.u16(p + 6);
  const name = r.str(p + 8);
  if (!name) return null;
  let q = name.end;
  const hasColor = r.u32(q); q += 4;
  if (hasColor !== 0 && hasColor !== 1) return null;
  let color = null;
  if (hasColor === 1) {
    const c = r.u32(q); q += 4;
    color = `#${(c & 0xffffff).toString(16).padStart(6, '0')}`; // stored as B, G, R, A
  }
  const kind = r.u32(q); q += 4;
  q += 1;
  return { from: Math.min(from, to), to: Math.max(from, to), name: name.s, color, kind, end: q };
}

function attrHead(r, p) {
  if (r.u32(p) !== 2) return null;
  const type = r.u32(p + 4);
  if (type < 0 || type > 10000) return null;
  const name = r.str(p + 8, 256);
  if (!name) return null;
  const j = name.end;
  if (!r.bytesEqual(j, HEAD_FLAGS)) return null;
  const bytes = r.u32(j + 10); const offset = r.u32(j + 14); const fine = r.u32(j + 18);
  if (bytes < 1 || bytes > 4 || offset < 0 || offset > 1023 || fine < 0 || fine > 1023) return null;
  return { type, name: name.s, bytes, offset, fine, tail: j + 22 };
}

/** Parse one attribute with its tail. Returns null when p is not an attribute. */
function readAttribute(r, p, limit) {
  const a = attrHead(r, p);
  if (!a) return null;
  let q = a.tail;
  a.ranges = [];
  if (r.bytesEqual(q, NORMAL_TAIL)) {
    const set = r.str(q + 16, 256);
    if (set) {
      let k = set.end;
      const count = r.u32(k); k += 4;
      let ok = count >= 0 && count < 256;
      for (let i = 0; ok && i < count; i++) {
        const rr = readRange(r, k);
        if (!rr) { ok = false; break; }
        a.ranges.push(rr);
        k = rr.end;
      }
      if (ok) { a.end = k + 8; return a; }
    }
  } else {
    // Colour wheel: str wheel name, u32 1, u8, u32 max.
    const wheel = r.str(q, 256);
    if (wheel && r.u32(wheel.end) === 1) {
      a.wheel = wheel.s;
      a.end = wheel.end + 9;
      return a;
    }
  }
  // Unknown tail: continue at the next attribute head or cell name.
  for (let k = q; k < limit; k++) {
    if (attrHead(r, k)) { a.end = k; return a; }
    const s = r.u32(k) === 1 ? r.str(k, 256) : null;
    if (s && r.b[s.end] === 0 && (r.u32(s.end + 1) === 3 || r.u32(s.end + 1) < 16)) { a.end = k; a.guessed = true; return a; }
  }
  a.end = limit;
  return a;
}

function isModeHeader(r, p) {
  const cells = r.u32(p + 4);
  return r.u32(p) === 4 && cells >= 1 && cells <= 256 && r.u32(p + 8) === 3 && r.u32(p + 12) === 5 && r.u32(p + 16) >= 0 && r.u32(p + 16) <= 1024;
}

function readMode(r, p, limit) {
  const cellCount = r.u32(p + 4);
  let q = p + 8;
  const cells = [];
  for (let c = 0; c < cellCount; c++) {
    if (r.u32(q) !== 3 || r.u32(q + 4) !== 5) return null;
    const n = r.u32(q + 8);
    q += 12;
    const attrs = [];
    for (let k = 0; k < n; k++) {
      const a = readAttribute(r, q, limit);
      if (!a) return null;
      attrs.push(a);
      q = a.end;
    }
    const name = r.str(q, 256);
    if (!name) return null;
    q = name.end + 1;
    cells.push({ name: name.s, attrs });
  }
  // Trailer: extra items (u32 2, u32 0, str), channel count, mode name.
  const items = r.u32(q); q += 4;
  if (items < 0 || items > 64) return { cells, name: '', channelCount: 0, end: q };
  for (let i = 0; i < items; i++) {
    const s = r.str(q + 8, 256);
    if (!s) return { cells, name: '', channelCount: 0, end: q };
    q = s.end;
  }
  const channelCount = r.u32(q); q += 4;
  const name = r.str(q, 256);
  return { cells, name: name ? name.s : '', channelCount: channelCount > 0 && channelCount <= 1024 ? channelCount : 0, end: name ? name.end : q };
}

/** Fallback when a mode cannot be read in order: every attribute head until the next mode. */
function scanMode(r, p, limit) {
  const attrs = [];
  for (let k = p + 8; k < limit; k++) {
    const a = attrHead(r, k);
    if (a) { attrs.push(a); k = a.tail - 1; }
  }
  return { cells: [{ name: 'Cell 1', attrs }], name: '', channelCount: 0, end: limit, guessed: true };
}

function findDefinitions(r) {
  const defs = [];
  for (let i = 8; i < r.n - 16; i++) {
    if (r.u32(i) !== 14 || r.u32(i - 4) !== 0 || !(r.u32(i - 8) >>> 31)) continue;
    const name = r.str(i + 4, 256);
    if (!name) continue;
    const man = r.str(name.end, 256);
    if (!man) continue;
    defs.push({ start: i - 8, name: name.s, manufacturer: man.s, guid: r.guid(man.end + 4), body: man.end + 20 });
    i = man.end;
  }
  return defs;
}

function readWheels(r, from, to) {
  const wheels = {};
  for (let i = from; i < to; i++) {
    if (r.u32(i) !== 1) continue;
    const s = r.str(i, 128);
    if (!s) continue;
    const count = r.u32(s.end);
    if (count < 1 || count > 64 || r.u32(s.end + 4) !== 4) continue;
    const slots = [];
    let k = s.end + 4;
    for (let n = 0; n < count; n++) {
      const rr = readRange(r, k);
      if (!rr) break;
      slots.push(rr);
      k = rr.end;
    }
    if (slots.length === count && slots.some((x) => x.color)) {
      wheels[s.s] = slots;
      i = k - 1;
    }
  }
  return wheels;
}

/** Patch records ("Fixture n") in file order. */
function findPatchRecords(r, from) {
  const recs = [];
  for (let i = from; i < r.n - 16; i++) {
    if (!(r.u32(i) >>> 31) || r.u32(i + 4) !== 2 || r.u32(i + 8) !== 5) continue;
    const name = r.str(i + 12, 128);
    if (!name) continue;
    // Patch records follow each other closely; stop at the first big gap.
    if (recs.length && i - recs[recs.length - 1].start > 4096) break;
    recs.push({ start: i, label: name.s, bodyStart: name.end });
    i = name.end - 1;
  }
  for (let k = 0; k < recs.length; k++) recs[k].end = k + 1 < recs.length ? recs[k + 1].start : Math.min(r.n, recs[k].bodyStart + 400);
  return recs;
}

/** List (one entry per patch record, same order) with each record's id in the group tree. */
function findTreeIds(r, from) {
  const out = [];
  let expectNext = null;
  for (let i = from; i < r.n - 16; i++) {
    if (r.u32(i) !== 1) continue;
    const s = r.str(i, 128);
    if (!s) continue;
    const e = s.end;
    const count = r.u32(e + 4);
    if (count < 1 || count > 1024) continue;
    const first = r.u32(e + 8);
    if (expectNext != null && first !== expectNext) continue;
    let consecutive = true;
    for (let k = 1; k < count && consecutive; k++) if (r.u32(e + 8 + 4 * k) !== first + k) consecutive = false;
    // The first entry must look exactly right; later ones only need to continue the id chain.
    if (!consecutive || (expectNext == null && r.u32(e + 12 + 4 * count) !== 7)) continue;
    out.push({ pos: i, treeId: r.u32(e + 8 + 4 * count) });
    expectNext = first + count;
    i = e + 8 + 4 * count;
  }
  return out;
}

/** Group tree (left panel in SoundSwitch): leaf id → { name, parent group name }. */
function readTree(r, from) {
  const leaves = new Map();
  const stack = [];
  for (let i = from; i < r.n - 16; i++) {
    if (r.u32(i) !== 1 || r.u32(i - 12) !== 3 || r.u32(i - 8) !== 2) continue;
    const s = r.str(i, 256);
    if (!s) continue;
    const dup = r.str(s.end, 256);
    const consume = () => {
      if (stack.length) stack[stack.length - 1].left -= 1;
      while (stack.length && stack[stack.length - 1].left <= 0) stack.pop();
    };
    if (dup) {
      const left = r.u32(dup.end);
      consume();
      if (left > 0 && left < 4096) stack.push({ name: s.s, left });
      i = dup.end + 3;
    } else {
      const id = r.u32(s.end);
      if (!leaves.has(id)) leaves.set(id, { name: s.s, group: stack.length ? stack[stack.length - 1].name : null });
      consume();
      i = s.end + 7;
    }
  }
  return leaves;
}

/**
 * Read SoundSwitchVenues.bin.
 * @returns {{ venue, definitions: [{ guid, name, manufacturer, modes: [{ name, cells, channelCount }], wheels }],
 *            fixtures: [{ name, definition, modeIndex, universe, address }], warnings: string[] }}
 */
export function parseSoundSwitchVenues(buffer) {
  const r = new Reader(buffer);
  const warnings = [];
  if (r.n < 64) throw new Error(tr('Fișierul SoundSwitch e gol sau incomplet'));
  let venue = 'SoundSwitch';
  for (let i = 0; i < 128; i++) { const s = r.str(i, 128); if (s) { venue = s.s; break; } }

  const defs = findDefinitions(r);
  if (!defs.length) throw new Error(tr('Nu am găsit fixturi în proiectul SoundSwitch'));
  const records = findPatchRecords(r, defs[0].body);
  const defsEnd = records.length ? records[0].start : r.n;
  defs.forEach((d, k) => { d.end = k + 1 < defs.length ? defs[k + 1].start : defsEnd; });

  for (const d of defs) {
    d.modes = [];
    const headers = [];
    for (let p = d.body; p < d.end - 20; p++) if (isModeHeader(r, p)) headers.push(p);
    let pos = d.body;
    for (let h = 0; h < headers.length; h++) {
      const p = headers[h];
      if (p < pos) continue;
      const limit = h + 1 < headers.length ? headers[h + 1] : d.end;
      let mode = readMode(r, p, limit);
      if (!mode || !mode.cells.some((c) => c.attrs.length)) { mode = scanMode(r, p, limit); warnings.push(tr('{name}: un mod a fost citit aproximativ', { name: d.name })); }
      if (!mode.name) mode.name = tr('Mod {n}', { n: d.modes.length + 1 });
      d.modes.push(mode);
      pos = mode.end;
    }
    d.wheels = readWheels(r, d.body, headers.length ? headers[0] : d.end);
  }

  const byGuid = new Map(defs.map((d) => [d.guid, d]));
  const fixtures = [];
  const recordFixture = [];
  for (const rec of records) {
    let found = null;
    for (let i = rec.bodyStart; i < rec.end - 25 && !found; i++) {
      const d = byGuid.get(r.guid(i));
      if (!d) continue;
      const modeIndex = r.u32(i + 17);
      const abs = r.u32(i + 21);
      if (modeIndex < 0 || modeIndex >= Math.max(1, d.modes.length) || abs < 0 || abs >= 512 * 256) continue;
      found = { definition: d, modeIndex, universe: Math.floor(abs / 512) + 1, address: (abs % 512) + 1 };
    }
    recordFixture.push(found);
    if (found) fixtures.push(found);
  }

  // Names from the group tree.
  const treeIds = findTreeIds(r, records.length ? records[records.length - 1].end : defsEnd);
  const tree = readTree(r, treeIds.length ? treeIds[treeIds.length - 1].pos : defsEnd);
  if (treeIds.length === records.length) {
    recordFixture.forEach((fx, k) => {
      if (!fx) return;
      const leaf = tree.get(treeIds[k].treeId);
      if (!leaf) return;
      const mode = fx.definition.modes[fx.modeIndex];
      const multiCell = mode && mode.cells.length > 1;
      fx.name = multiCell && leaf.group ? leaf.group : leaf.name;
      if (leaf.group) fx.group = leaf.group;
    });
  } else if (records.length) {
    warnings.push(tr('Numele fixturilor nu au putut fi citite; folosesc numele modelului.'));
  }
  fixtures.sort((a, b) => a.universe - b.universe || a.address - b.address);
  // Missing names get the model name; repeated names get a number (in DMX order).
  for (const fx of fixtures) {
    fx.name = (fx.name || '').trim() || fx.definition.name;
    if (fx.group) fx.group = fx.group.trim();
  }
  const total = {};
  for (const fx of fixtures) total[fx.name] = (total[fx.name] || 0) + 1;
  const seen = {};
  for (const fx of fixtures) {
    if (total[fx.name] < 2) continue;
    seen[fx.name] = (seen[fx.name] || 0) + 1;
    fx.name = `${fx.name} ${seen[fx.name]}`;
  }
  return {
    venue,
    definitions: defs.map(({ guid, name, manufacturer, modes, wheels }) => ({ guid, name, manufacturer, modes, wheels })),
    fixtures,
    warnings,
  };
}

const STROBE_KIND = { 43: 'open', 44: 'closed', 46: 'strobe' };

function strobeRanges(ranges) {
  if (!ranges.length) return DEFAULT_STROBE_RANGES.map((x) => ({ ...x }));
  const out = ranges.map((x) => {
    const mode = STROBE_KIND[x.kind] || (/random/i.test(x.name) ? 'random' : /pulse/i.test(x.name) ? 'pulse' : /close/i.test(x.name) ? 'closed' : /strob/i.test(x.name) ? 'strobe' : 'open');
    return { from: x.from, to: x.to, mode, ...(mode === 'strobe' || mode === 'random' ? { hzFrom: 1, hzTo: 20 } : mode === 'pulse' ? { hzFrom: 1, hzTo: 10 } : {}) };
  }).sort((a, b) => a.from - b.from);
  // Values between ranges behave like "open".
  const filled = [];
  let next = 0;
  for (const x of out) {
    if (x.from > next) filled.push({ from: next, to: x.from - 1, mode: 'open' });
    filled.push(x);
    next = Math.max(next, x.to + 1);
  }
  if (next <= 255) filled.push({ from: next, to: 255, mode: 'open' });
  return filled;
}

function convertAttribute(a, def) {
  let type = TYPE[a.type];
  if (a.type === ROTATION_TYPE) type = /prism/i.test(a.name) ? 'prismRot' : 'goboRot';
  if (!type) type = NO_VISUAL.has(a.type) ? 'none' : typeByName(a.name);
  const out = { type, label: a.name };
  if (type === 'strobe') out.ranges = strobeRanges(a.ranges);
  if (type === 'colorWheel') {
    const slots = (def.wheels[a.wheel] || []).filter((s) => s.color).sort((x, y) => x.from - y.from);
    if (slots.length) out.ranges = slots.map((s) => ({ from: s.from, to: s.to, color: s.color }));
    else out.type = 'none';
  }
  if (type === 'gobo') out.ranges = goboRanges(8);
  if (type === 'prism') out.ranges = [{ from: 0, to: 127, prism: 0 }, { from: 128, to: 255, prism: 3 }];
  if (type === 'goboRot' || type === 'prismRot') out.ranges = SS_ROTATION.map((r) => ({ ...r }));
  const known = knownOf(def).ranges;
  if (known && known[type]) out.ranges = known[type]();
  return out;
}

/** One SoundSwitch definition + mode → FreeVisualizer profile. */
export function ssProfile(def, modeIndex) {
  const mode = def.modes[modeIndex] || def.modes[0];
  if (!mode) throw new Error(tr('{name}: nu are moduri DMX', { name: def.name }));
  const channels = [];
  const colorCells = mode.cells.filter((c) => c.attrs.some((a) => COLOR_TYPES.has(TYPE[a.type] || typeByName(a.name))));
  const pixelOf = new Map(colorCells.length > 1 ? colorCells.map((c, i) => [c, i]) : []);
  for (const cell of mode.cells) {
    for (const a of cell.attrs) {
      const conv = convertAttribute(a, def);
      if (pixelOf.has(cell)) conv.pixel = pixelOf.get(cell);
      channels[a.offset] = conv;
      if (a.bytes >= 2 && a.fine !== a.offset) {
        channels[a.fine] = { type: FINE[conv.type] || 'none', label: `${a.name} fine`, ...(pixelOf.has(cell) ? { pixel: pixelOf.get(cell) } : {}) };
      }
    }
  }
  const count = Math.max(channels.length, mode.channelCount || 0);
  const missing = (knownOf(def).missing || {})[count] || {};
  for (let i = 0; i < count; i++) if (!channels[i]) channels[i] = missing[i] ? missing[i]() : { type: 'none', label: tr('Canal {n}', { n: i + 1 }) };

  const has = (t) => channels.some((c) => c.type === t);
  const text = `${def.name} ${def.manufacturer}`;
  const pixels = pixelOf.size;
  let kind = 'par';
  if (has('pan') || has('tilt')) kind = 'moving';
  else if (pixels === 7) kind = 'retro';
  else if (pixels > 1) kind = 'bar';
  else if (has('fog')) kind = 'fog';
  else if (/strob/i.test(text) && !has('red')) kind = 'strobe';
  else if (/blinder/i.test(text)) kind = 'blinder';
  // LED retro with RGB heads: its white is the warm "filament" LED, and LEDs have no tungsten lag.
  const ledRetro = kind === 'retro' && has('red');
  if (ledRetro) for (const c of channels) if (c.type === 'white') c.type = 'warmWhite';
  let style;
  if (kind === 'moving') style = /beam/i.test(text) ? 'beam' : /wash/i.test(text) ? 'wash' : has('gobo') ? 'spot' : (has('red') || has('cyan')) ? 'wash' : 'spot';
  const beamAngle = kind === 'moving' ? { beam: [4, 4], spot: [15, 15], wash: [20, 20] }[style]
    : ({ retro: [40, 40], bar: [25, 25], strobe: [110, 110], blinder: [60, 60], fog: [20, 20] }[kind] || [25, 25]);
  const slug = `${def.manufacturer}-${def.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id: `ss-${slug}-${modeIndex}`,
    name: `${def.name} (${mode.name})`,
    manufacturer: def.manufacturer,
    source: 'soundswitch',
    kind,
    ...(style ? { style } : {}),
    pixels: pixels > 1 ? pixels : 1,
    ...(kind === 'retro' && !has('red') ? { defaultColor: '#ffb347' } : {}),
    ...(ledRetro ? { tungsten: false } : {}),
    beamAngle,
    panRange: 540,
    tiltRange: 270,
    channels,
  };
}

/** Position hint from the names DJs give: stânga/dreapta, centru, POZ n. */
function sideScore(name) {
  const n = name.toLowerCase();
  const left = /st[aâ]nga|stg\b|left|\bst\b/.test(n);
  const right = /dreapta|dr\b|right/.test(n);
  const center = /centr|center|mijloc/.test(n);
  const side = left && !right ? -1 : right && !left ? 1 : 0;
  const poz = Number((/poz(?:i[tț]ia)?\s*(\d+)/.exec(n) || [])[1]) || 0;
  return { side: side * (center ? 0.5 : 1), poz };
}

function spread(count, min, max) {
  if (count <= 0) return [];
  if (count === 1) return [(min + max) / 2];
  return Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
}

/**
 * Fixtures + profiles placed in a stage layout (truss, DJ booth, walls).
 * @param stage { trussY, trussZ, trussHalf, roomHalfWidth, backZ }
 */
export function ssPlacement(parsed, stage) {
  const profiles = new Map();
  const items = parsed.fixtures.map((fx, order) => {
    const key = `${fx.definition.guid}:${fx.modeIndex}`;
    if (!profiles.has(key)) profiles.set(key, ssProfile(fx.definition, fx.modeIndex));
    const profile = profiles.get(key);
    return { fx, profile, order, ...sideScore(fx.name) };
  });
  const sortLR = (list) => list.sort((a, b) => a.side - b.side || a.poz - b.poz || a.order - b.order);
  const groups = { truss: [], front: [], floor: [], fog: [], other: [] };
  for (const it of items) {
    const k = it.profile.kind;
    if (k === 'moving' || k === 'strobe' || k === 'blinder' || k === 'pinspot') groups.truss.push(it);
    else if (k === 'retro' || k === 'bar') groups.front.push(it);
    else if (k === 'par') groups.floor.push(it);
    else if (k === 'fog' || k === 'lowfog' || k === 'spark') groups.fog.push(it);
    else groups.other.push(it);
  }
  const v = (x, y, z) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100 });
  const placed = [];
  const put = (it, position, rotation) => placed.push({ ...it, position, rotation });
  const { trussY, trussZ, trussHalf, roomHalfWidth, backZ } = stage;
  sortLR(groups.truss);
  spread(groups.truss.length, -trussHalf, trussHalf).forEach((x, i) => put(groups.truss[i], v(x, trussY - 0.17, trussZ), v(180, 0, 0)));
  sortLR(groups.front);
  spread(groups.front.length, -trussHalf * 0.6, trussHalf * 0.6).forEach((x, i) => put(groups.front[i], v(x, trussY - 0.4, trussZ + 0.3), v(90, 0, 0)));
  sortLR(groups.floor);
  const wall = Math.min(roomHalfWidth - 1.5, Math.max(4, groups.floor.length * 1.6));
  spread(groups.floor.length, -wall, wall).forEach((x, i) => put(groups.floor[i], v(x, 0, backZ + 0.4), v(-12, 0, 0)));
  spread(groups.fog.length, -2.2, 2.2).forEach((x, i) => put(groups.fog[i], v(x, 0, trussZ + 1.6), v(0, 0, 0)));
  spread(groups.other.length, -4, 4).forEach((x, i) => put(groups.other[i], v(x, 0, trussZ + 3), v(0, 0, 0)));
  return { profiles: [...profiles.values()], placed };
}
