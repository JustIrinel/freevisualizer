// Live DMX input (Server-Sent Events from the local server), demo generator
// output and manual overrides, merged into one buffer per universe.

export class DmxStore extends EventTarget {
  constructor() {
    super();
    this.live = new Map(); // displayUniverse -> Uint8Array(512)
    this.demo = new Map();
    this.frame = new Map();
    this.overrides = new Map(); // displayUniverse -> Map(channelIndex0 -> value)
    this.artnetOffset = 1; // Art-Net universe 0 is shown as universe 1
    this.useDemo = false;
    this.connected = false;
    this.status = null;
    this.lastLiveAt = 0;
    this.activeInputs = new Map(); // "artnet:0" -> { protocol, universe, display, source, at }
    this._pps = { last: 0, packets: 0, rate: 0 };
  }

  connect() {
    if (this.es) this.es.close();
    const es = new EventSource('/api/events');
    this.es = es;
    es.onopen = () => { this.connected = true; this._emit('connection'); };
    es.onerror = () => { this.connected = false; this._emit('connection'); };
    es.addEventListener('dmx', (ev) => this._onDmx(ev.data));
    es.addEventListener('status', (ev) => {
      try {
        this.status = JSON.parse(ev.data);
        // Use the server clock: events can arrive bunched when the tab is busy.
        const total = this.status.artnet.packets + this.status.sacn.packets;
        const now = this.status.time;
        if (this._pps.last && now > this._pps.last) this._pps.rate = Math.max(0, (total - this._pps.packets) / ((now - this._pps.last) / 1000));
        this._pps.last = now;
        this._pps.packets = total;
      } catch (_) { /* ignore */ }
      this._emit('status');
    });
  }

  get packetsPerSecond() {
    return this._pps.rate;
  }

  displayUniverse(protocol, universe) {
    return protocol === 'artnet' ? universe + this.artnetOffset : universe;
  }

  _onDmx(line) {
    const [protocol, u, b64] = line.split('|');
    const universe = this.displayUniverse(protocol, Number(u));
    const bin = atob(b64);
    let buf = this.live.get(universe);
    if (!buf) { buf = new Uint8Array(512); this.live.set(universe, buf); }
    for (let i = 0; i < 512 && i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    this.lastLiveAt = performance.now();
    this.activeInputs.set(`${protocol}:${u}`, { protocol, universe: Number(u), display: universe, at: Date.now() });
  }

  /** Remap live buffers after the Art-Net offset changed. */
  setArtnetOffset(offset) {
    this.artnetOffset = offset;
    this.live.clear();
    this.activeInputs.clear();
  }

  demoBuffer(universe) {
    let buf = this.demo.get(universe);
    if (!buf) { buf = new Uint8Array(512); this.demo.set(universe, buf); }
    return buf;
  }

  setOverride(universe, address, value) {
    let m = this.overrides.get(universe);
    if (!m) { m = new Map(); this.overrides.set(universe, m); }
    m.set(address - 1, value);
  }

  clearOverrides(universe, fromAddress, count) {
    const m = this.overrides.get(universe);
    if (!m) return;
    for (let i = 0; i < count; i++) m.delete(fromAddress - 1 + i);
  }

  hasOverride(universe, address) {
    const m = this.overrides.get(universe);
    return !!(m && m.has(address - 1));
  }

  /** Build the merged buffers for this render frame. */
  beginFrame() {
    const universes = new Set([...this.live.keys(), ...this.demo.keys(), ...this.overrides.keys()]);
    for (const u of universes) {
      let out = this.frame.get(u);
      if (!out) { out = new Uint8Array(512); this.frame.set(u, out); }
      const src = this.useDemo ? this.demo.get(u) : this.live.get(u);
      if (src) out.set(src); else out.fill(0);
      const ov = this.overrides.get(u);
      if (ov) for (const [i, v] of ov) out[i] = v;
    }
  }

  get(universe) {
    return this.frame.get(universe) || null;
  }

  get receiving() {
    return performance.now() - this.lastLiveAt < 2500;
  }

  _emit(type) {
    this.dispatchEvent(new Event(type));
  }
}
