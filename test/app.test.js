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
  for (const t of TOOLS) if (t.strict !== false) check(t.input_schema, t.name);
  const cleaned = cleanContent([{ type: 'thinking' }, { type: 'tool_use' }, { type: 'fallback' }, { type: 'text', text: 'ok' }, { type: 'tool_use' }]);
  assert.deepStrictEqual(cleaned.map((b) => b.type), ['fallback', 'text', 'tool_use']);
});
