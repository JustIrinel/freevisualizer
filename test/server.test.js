'use strict';
const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const { parseArtDmx, buildPollReply, ArtNetReceiver, OP_POLL_REPLY } = require('../server/artnet');
const { parseSacn } = require('../server/sacn');

function artDmx(net, sub, data) {
  const b = Buffer.alloc(18 + data.length);
  b.write('Art-Net\0', 0, 'ascii');
  b.writeUInt16LE(0x5000, 8);
  b[11] = 14;
  b[14] = sub;
  b[15] = net;
  b.writeUInt16BE(data.length, 16);
  Buffer.from(data).copy(b, 18);
  return b;
}

test('parses ArtDmx with 15-bit port address', () => {
  const pkt = parseArtDmx(artDmx(1, 0x23, [10, 20, 30]));
  assert.strictEqual(pkt.universe, 0x123);
  assert.deepStrictEqual([...pkt.data.subarray(0, 4)], [10, 20, 30, 0]);
  assert.strictEqual(pkt.data.length, 512);
});

test('rejects non Art-Net packets', () => {
  assert.strictEqual(parseArtDmx(Buffer.from('hello world, not art-net')), null);
});

test('builds a valid ArtPollReply', () => {
  const b = buildPollReply({ ip: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:ff', shortName: 'FreeVisualizer', longName: 'x', firstUniverse: 4, bindIndex: 2 });
  assert.strictEqual(b.length, 239);
  assert.strictEqual(b.toString('ascii', 0, 7), 'Art-Net');
  assert.strictEqual(b.readUInt16LE(8), OP_POLL_REPLY);
  assert.deepStrictEqual([...b.subarray(10, 14)], [192, 168, 1, 20]);
  assert.strictEqual(b.toString('ascii', 26, 40), 'FreeVisualizer');
  assert.deepStrictEqual([...b.subarray(190, 194)], [4, 5, 6, 7]);
  assert.strictEqual(b[211], 2);
});

test('parses an E1.31 data packet', () => {
  const b = Buffer.alloc(126 + 3);
  Buffer.from([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0, 0, 0]).copy(b, 4);
  b.writeUInt32BE(4, 18);
  b.writeUInt32BE(2, 40);
  b[108] = 100;
  b.writeUInt16BE(7, 113);
  b.writeUInt16BE(4, 123);
  b[125] = 0;
  b[126] = 255; b[127] = 128; b[128] = 1;
  const pkt = parseSacn(b);
  assert.strictEqual(pkt.universe, 7);
  assert.deepStrictEqual([...pkt.data.subarray(0, 3)], [255, 128, 1]);
});

test('receiver emits DMX and answers ArtPoll over UDP', async () => {
  const port = 16454 + Math.floor(Math.random() * 1000);
  const rx = new ArtNetReceiver({ port, host: '127.0.0.1' });
  await rx.start();
  const got = new Promise((resolve) => rx.once('dmx', resolve));
  const tx = dgram.createSocket('udp4');
  await new Promise((r) => tx.bind(0, '127.0.0.1', r));
  tx.send(artDmx(0, 2, [1, 2, 3]), port, '127.0.0.1');
  const ev = await got;
  assert.strictEqual(ev.universe, 2);
  assert.strictEqual(ev.data[2], 3);

  const reply = new Promise((resolve) => tx.once('message', resolve));
  const poll = Buffer.alloc(14);
  poll.write('Art-Net\0', 0, 'ascii');
  poll.writeUInt16LE(0x2000, 8);
  poll[11] = 14;
  tx.send(poll, port, '127.0.0.1');
  const msg = await reply;
  assert.strictEqual(msg.readUInt16LE(8), OP_POLL_REPLY);
  tx.close();
  rx.stop();
});

test('the Open Fixture Library list shipped with the app is usable offline', () => {
  const snap = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../server/ofl-snapshot.json'), 'utf8'));
  assert.ok(snap.keys.length > 500);
  assert.ok(snap.keys.every((k) => /^[a-z0-9][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(k)));
  assert.strictEqual(snap.manufacturers['chauvet-dj'].name, 'Chauvet DJ');
});
