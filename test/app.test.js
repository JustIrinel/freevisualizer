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

test('3D models: upload, content-hash name, served back; bad names rejected', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freevis-'));
  const app = createApp({ dataDir, port: rnd(), artnetPort: rnd(), sacnPort: rnd(), host: '127.0.0.1' });
  const { port } = await app.start();
  const body = Buffer.from('glTF fake model bytes');
  const up = await fetch(`http://127.0.0.1:${port}/api/models?ext=glb`, { method: 'POST', body });
  const { file } = await up.json();
  assert.match(file, /^[a-f0-9]{40}\.glb$/);
  const back = Buffer.from(await (await fetch(`http://127.0.0.1:${port}/api/models/${file}`)).arrayBuffer());
  assert.deepStrictEqual(back, body);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/api/models?ext=exe`, { method: 'POST', body })).status, 400);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/api/models/..%2Fsettings.json`)).status, 400);
  await app.stop();
});

test('assistant: key is stored on the server and never returned', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freevis-'));
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const app = createApp({ dataDir, port: rnd(), artnetPort: rnd(), sacnPort: rnd(), host: '127.0.0.1' });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  assert.strictEqual((await (await fetch(`${base}/api/assistant/status`)).json()).configured, false);
  const noKey = await fetch(`${base}/api/assistant`, { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'salut' }] }) });
  assert.strictEqual(noKey.status, 400);
  const secret = 'sk-ant-test-SECRET-123';
  const cfg = await (await fetch(`${base}/api/assistant/config`, { method: 'POST', body: JSON.stringify({ apiKey: secret, model: 'claude-sonnet-5-5' }) })).text();
  assert.ok(!cfg.includes('SECRET'));
  const st = await (await fetch(`${base}/api/assistant/status`)).json();
  assert.deepStrictEqual([st.configured, st.model], [true, 'claude-sonnet-5-5']);
  for (const url of ['/api/info', '/api/assistant/status']) assert.ok(!(await (await fetch(base + url)).text()).includes('SECRET'));
  assert.ok(fs.readFileSync(path.join(dataDir, 'assistant.json'), 'utf8').includes(secret));
  await app.stop();
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
});

test('assistant: tool schemas are strict-compatible', () => {
  const { TOOLS, cleanContent } = require('../server/assistant');
  const check = (schema, where) => {
    if (schema.anyOf) return schema.anyOf.forEach((s) => check(s, where));
    if (schema.type === 'object') {
      assert.strictEqual(schema.additionalProperties, false, where);
      assert.deepStrictEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), where);
      for (const [k, v] of Object.entries(schema.properties)) check(v, `${where}.${k}`);
    }
    if (schema.type === 'array') check(schema.items, where);
    for (const bad of ['minimum', 'maximum', 'minLength', 'maxLength']) assert.ok(!(bad in schema), `${where} uses ${bad}`);
  };
  for (const t of TOOLS) check(t.input_schema, t.name);
  const cleaned = cleanContent([{ type: 'thinking' }, { type: 'tool_use' }, { type: 'fallback' }, { type: 'text', text: 'ok' }, { type: 'tool_use' }]);
  assert.deepStrictEqual(cleaned.map((b) => b.type), ['fallback', 'text', 'tool_use']);
});

test('limited licence: live DMX is not forwarded until a key is activated', async () => {
  const dgram = require('dgram');
  const { createLicense, deviceCode, signLicense, TRIAL_MS } = require('../server/license');
  const { createKeyPair } = require('../server/license-admin');
  const kp = createKeyPair();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freevis-'));
  const device = deviceCode('test-machine');
  let t = Date.now();
  const license = createLicense({ dir: dataDir, device, publicKey: kp.publicKey, now: () => t });
  license.status();
  t += TRIAL_MS + 1000; // trial over
  const artnetPort = rnd();
  const app = createApp({ dataDir, port: rnd(), artnetPort, sacnPort: rnd(), host: '127.0.0.1', license });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  assert.strictEqual((await (await fetch(`${base}/api/license`)).json()).status, 'limited');

  // Art-Net DMX packet, universe 0, channel 1 = 255
  const pkt = Buffer.alloc(18 + 512);
  pkt.write('Art-Net\0', 0, 'latin1');
  pkt.writeUInt16LE(0x5000, 8);
  pkt.writeUInt16BE(14, 10);
  pkt.writeUInt16BE(512, 16);
  pkt[18] = 255;
  const sock = dgram.createSocket('udp4');
  const send = () => new Promise((r) => sock.send(pkt, artnetPort, '127.0.0.1', r));
  const events = async () => {
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: ctl.signal });
    const reader = res.body.getReader();
    let text = '';
    const until = Date.now() + 400;
    while (Date.now() < until) {
      const r = await Promise.race([reader.read(), new Promise((ok) => setTimeout(() => ok({ timeout: true }), 100))]);
      if (r.value) text += Buffer.from(r.value).toString();
      if (r.done) break;
    }
    ctl.abort();
    return text;
  };
  await send(); await new Promise((r) => setTimeout(r, 100));
  assert.doesNotMatch(await events(), /event: dmx/, 'no DMX in limited mode');

  const bad = await fetch(`${base}/api/license`, { method: 'POST', body: JSON.stringify({ key: 'FVL1.x.y' }) });
  assert.strictEqual(bad.status, 400);
  const key = signLicense(kp.privateKey, { license: 'L0001', device, name: 'Test' });
  const ok = await (await fetch(`${base}/api/license`, { method: 'POST', body: JSON.stringify({ key }) })).json();
  assert.strictEqual(ok.status, 'active');
  await send(); await new Promise((r) => setTimeout(r, 100));
  assert.match(await events(), /event: dmx/, 'DMX flows once activated');
  sock.close();
  await app.stop();
});
