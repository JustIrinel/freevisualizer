'use strict';
// Sends an Art-Net test pattern (rainbow + movement) to check the visualizer
// without SoundSwitch.  Usage: node tools/send-test-artnet.js [ip] [universe]
const dgram = require('dgram');

const target = process.argv[2] || '127.0.0.1';
const universe = Number(process.argv[3] || 0);
const sock = dgram.createSocket('udp4');
let seq = 0;

function artDmx(uni, data) {
  const b = Buffer.alloc(18 + 512);
  b.write('Art-Net\0', 0, 'ascii');
  b.writeUInt16LE(0x5000, 8);
  b[10] = 0; b[11] = 14;
  b[12] = (seq = (seq % 255) + 1);
  b[13] = 0;
  b[14] = uni & 0xff;
  b[15] = (uni >> 8) & 0x7f;
  b.writeUInt16BE(512, 16);
  Buffer.from(data).copy(b, 18);
  return b;
}

const start = Date.now();
setInterval(() => {
  const t = (Date.now() - start) / 1000;
  const d = new Uint8Array(512);
  for (let i = 0; i < 512; i += 3) {
    const h = (t * 0.2 + i / 60) % 1;
    d[i] = Math.round(255 * Math.max(0, Math.cos(h * 6.283) * 0.5 + 0.5));
    d[i + 1] = Math.round(255 * Math.max(0, Math.cos((h - 0.33) * 6.283) * 0.5 + 0.5));
    if (i + 2 < 512) d[i + 2] = Math.round(255 * Math.max(0, Math.cos((h - 0.66) * 6.283) * 0.5 + 0.5));
  }
  sock.send(artDmx(universe, d), 6454, target);
}, 25);
console.log(`Trimit Art-Net (univers ${universe}) către ${target}:6454 – Ctrl+C pentru oprire.`);
