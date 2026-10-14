'use strict';
// Streaming ACN (E1.31) receiver. Joins the multicast groups for the requested
// universes and also accepts unicast packets sent straight to this machine.

const dgram = require('dgram');
const { EventEmitter } = require('events');
const { ipv4Interfaces } = require('./artnet');

const SACN_PORT = 5568;
const ACN_ID = Buffer.from([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]);

function multicastAddress(universe) {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

/** Parse an E1.31 data packet. Returns { universe, priority, sequence, data } or null. */
function parseSacn(buf) {
  if (buf.length < 126) return null;
  if (buf.compare(ACN_ID, 0, 12, 4, 16) !== 0) return null;
  if (buf.readUInt32BE(18) !== 0x00000004) return null; // VECTOR_ROOT_E131_DATA
  if (buf.readUInt32BE(40) !== 0x00000002) return null; // VECTOR_E131_DATA_PACKET
  const priority = buf[108];
  const sequence = buf[111];
  const options = buf[112];
  if (options & 0x40) return null; // stream terminated
  const universe = buf.readUInt16BE(113);
  const count = buf.readUInt16BE(123); // includes start code
  const startCode = buf[125];
  if (startCode !== 0) return null; // only plain DMX levels
  const len = Math.min(count - 1, 512, buf.length - 126);
  const data = Buffer.alloc(512);
  if (len > 0) buf.copy(data, 0, 126, 126 + len);
  return { universe, priority, sequence, data };
}

class SacnReceiver extends EventEmitter {
  constructor({ universes = [1, 2, 3, 4], port = SACN_PORT } = {}) {
    super();
    this.universes = universes;
    this.port = port;
    this.packets = 0;
    this.sources = new Map();
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
      sock.on('message', (msg, rinfo) => {
        const pkt = parseSacn(msg);
        if (!pkt) return;
        this.packets++;
        this.sources.set(rinfo.address, Date.now());
        this.emit('dmx', { protocol: 'sacn', universe: pkt.universe, data: pkt.data, source: rinfo.address });
      });
      sock.bind(this.port, () => {
        sock.__bound = true;
        this.joinUniverses(this.universes);
        resolve();
      });
    });
  }

  joinUniverses(universes) {
    if (!this.socket) return;
    const ifaces = ipv4Interfaces().filter((i) => !i.internal);
    for (const u of universes) {
      const group = multicastAddress(u);
      const targets = ifaces.length ? ifaces.map((i) => i.address) : [undefined];
      for (const addr of targets) {
        try { this.socket.addMembership(group, addr); } catch (_) { /* already joined / no multicast */ }
      }
    }
  }

  stop() {
    if (this.socket) this.socket.close();
    this.socket = null;
  }
}

module.exports = { SacnReceiver, parseSacn, multicastAddress, SACN_PORT };
