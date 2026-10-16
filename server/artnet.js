'use strict';
// Art-Net 4 receiver: parses ArtDmx and answers ArtPoll so that controllers
// (SoundSwitch, Rekordbox Lighting, QLC+, ...) discover the visualizer as a node.

const dgram = require('dgram');
const os = require('os');
const { EventEmitter } = require('events');

const ARTNET_PORT = 6454;
const HEADER = Buffer.from('Art-Net\0', 'ascii');
const OP_POLL = 0x2000;
const OP_POLL_REPLY = 0x2100;
const OP_DMX = 0x5000;

function isArtNet(buf) {
  return buf.length >= 12 && buf.compare(HEADER, 0, 8, 0, 8) === 0;
}

function opcode(buf) {
  return buf.readUInt16LE(8);
}

/** Parse an ArtDmx packet. Returns { universe, sequence, data } or null. */
function parseArtDmx(buf) {
  if (!isArtNet(buf) || opcode(buf) !== OP_DMX || buf.length < 18) return null;
  const sequence = buf[12];
  const subUni = buf[14];
  const net = buf[15] & 0x7f;
  const length = buf.readUInt16BE(16);
  const universe = (net << 8) | subUni; // 15-bit port address
  const len = Math.min(length, 512, buf.length - 18);
  if (len <= 0) return null;
  const data = Buffer.alloc(512);
  buf.copy(data, 0, 18, 18 + len);
  return { universe, sequence, data };
}

/** Build an ArtPollReply advertising up to 4 output ports starting at `firstUniverse`. */
function buildPollReply({ ip, mac, shortName, longName, firstUniverse = 0, bindIndex = 1, packets = 0 }) {
  const b = Buffer.alloc(239);
  HEADER.copy(b, 0);
  b.writeUInt16LE(OP_POLL_REPLY, 8);
  const ipParts = ip.split('.').map((n) => parseInt(n, 10) & 0xff);
  for (let i = 0; i < 4; i++) b[10 + i] = ipParts[i] || 0;
  b.writeUInt16LE(ARTNET_PORT, 14);
  b[16] = 0; b[17] = 1; // firmware version
  b[18] = (firstUniverse >> 8) & 0x7f; // NetSwitch
  b[19] = (firstUniverse >> 4) & 0x0f; // SubSwitch
  b.writeUInt16BE(0x00ff, 20); // OEM: unknown
  b[22] = 0; // UBEA
  b[23] = 0xd0; // Status1: indicators normal, port address set by front panel
  b.writeUInt16LE(0x0000, 24); // ESTA manufacturer
  b.write(shortName.slice(0, 17), 26, 'ascii');
  b.write(longName.slice(0, 63), 44, 'ascii');
  b.write(`#0001 [${String(packets % 10000).padStart(4, '0')}] FreeVisualizer OK`.slice(0, 63), 108, 'ascii');
  b[172] = 0; b[173] = 4; // NumPorts
  for (let i = 0; i < 4; i++) {
    b[174 + i] = 0x80; // can output DMX512 from Art-Net
    b[178 + i] = 0x00; // GoodInput
    b[182 + i] = 0x80; // GoodOutput: data being transmitted
    b[186 + i] = 0x00; // SwIn
    b[190 + i] = ((firstUniverse & 0x0f) + i) & 0x0f; // SwOut
  }
  b[200] = 0x00; // Style: StNode
  const macParts = (mac || '00:00:00:00:00:00').split(':').map((h) => parseInt(h, 16) || 0);
  for (let i = 0; i < 6; i++) b[201 + i] = macParts[i];
  for (let i = 0; i < 4; i++) b[207 + i] = ipParts[i] || 0; // BindIp
  b[211] = bindIndex;
  b[212] = 0x08; // Status2: supports 15-bit port address
  return b;
}

function ipv4Interfaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' || i.family === 4) out.push({ name, address: i.address, netmask: i.netmask, mac: i.mac, internal: i.internal });
    }
  }
  return out;
}

function sameSubnet(a, b, mask) {
  const toInt = (s) => s.split('.').reduce((acc, n) => ((acc << 8) | (parseInt(n, 10) & 0xff)) >>> 0, 0);
  const m = toInt(mask);
  return ((toInt(a) & m) >>> 0) === ((toInt(b) & m) >>> 0);
}

/** Pick the local interface that is on the same network as `remote`. */
function localInterfaceFor(remote) {
  const list = ipv4Interfaces();
  if (remote.startsWith('127.')) return list.find((i) => i.internal) || { address: '127.0.0.1', mac: '00:00:00:00:00:00' };
  return list.find((i) => !i.internal && sameSubnet(i.address, remote, i.netmask))
    || list.find((i) => !i.internal)
    || { address: '127.0.0.1', mac: '00:00:00:00:00:00' };
}

class ArtNetReceiver extends EventEmitter {
  constructor({ port = ARTNET_PORT, host = '0.0.0.0', universesToAdvertise = 8 } = {}) {
    super();
    this.port = port;
    this.host = host;
    this.universesToAdvertise = universesToAdvertise;
    this.packets = 0;
    this.sources = new Map(); // ip -> last seen
    this.socket = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket = sock;
      sock.on('error', (err) => {
        if (!sock.__bound) reject(err);
        else this.emit('error', err);
      });
      sock.on('message', (msg, rinfo) => this._onMessage(msg, rinfo));
      sock.bind(this.port, this.host, () => {
        sock.__bound = true;
        try { sock.setBroadcast(true); } catch (_) { /* ignore */ }
        resolve();
      });
    });
  }

  stop() {
    if (this.socket) this.socket.close();
    this.socket = null;
  }

  _onMessage(msg, rinfo) {
    if (!isArtNet(msg)) return;
    const op = opcode(msg);
    if (op === OP_DMX) {
      const pkt = parseArtDmx(msg);
      if (!pkt) return;
      this.packets++;
      this.sources.set(rinfo.address, Date.now());
      this.emit('dmx', { protocol: 'artnet', universe: pkt.universe, data: pkt.data, source: rinfo.address });
    } else if (op === OP_POLL) {
      this._replyToPoll(rinfo);
    }
  }

  _replyToPoll(rinfo) {
    const iface = localInterfaceFor(rinfo.address);
    // One reply per block of 4 universes (BindIndex 1..n), as Art-Net 4 requires.
    const blocks = Math.max(1, Math.ceil(this.universesToAdvertise / 4));
    for (let i = 0; i < blocks; i++) {
      const reply = buildPollReply({
        ip: iface.address,
        mac: iface.mac,
        shortName: 'FreeVisualizer',
        longName: 'FreeVisualizer - vizualizator 3D (Art-Net/sACN)',
        firstUniverse: i * 4,
        bindIndex: i + 1,
        packets: this.packets,
      });
      // Replies go to the poller's address on the Art-Net port; also mirror to the
      // source port in case the controller polls from an ephemeral port.
      const targets = new Set([`${rinfo.address}:${ARTNET_PORT}`, `${rinfo.address}:${rinfo.port}`]);
      for (const t of targets) {
        const [addr, port] = t.split(':');
        this.socket.send(reply, Number(port), addr, () => {});
      }
    }
    this.emit('poll', { source: rinfo.address });
  }
}

module.exports = { ArtNetReceiver, parseArtDmx, buildPollReply, isArtNet, ARTNET_PORT, OP_DMX, OP_POLL, OP_POLL_REPLY, ipv4Interfaces };
