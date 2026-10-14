'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { createApp } = require('../server/app');

const rnd = () => 20000 + Math.floor(Math.random() * 20000);

test('app starts, serves the UI and API, and stops cleanly', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freevis-'));
  const app = createApp({ dataDir, port: rnd(), artnetPort: rnd(), sacnPort: rnd(), host: '127.0.0.1' });
  const { port } = await app.start();
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /FreeVisualizer/);
  const info = await (await fetch(`http://127.0.0.1:${port}/api/info`)).json();
  assert.strictEqual(info.port, port);
  const put = await fetch(`http://127.0.0.1:${port}/api/projects/Test`, { method: 'PUT', body: '{"fixtures":[]}' });
  assert.strictEqual(put.status, 200);
  assert.ok(fs.existsSync(path.join(dataDir, 'projects', 'Test.json')));
  await app.stop();
});

test('falls back to the next free port when the preferred one is busy', async () => {
  const blocker = net.createServer();
  const busy = rnd();
  await new Promise((r) => blocker.listen(busy, '127.0.0.1', r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freevis-'));
  const app = createApp({ dataDir, port: busy, artnetPort: rnd(), sacnPort: rnd(), host: '127.0.0.1' });
  const { port } = await app.start();
  assert.notStrictEqual(port, busy);
  await app.stop();
  blocker.close();
});
