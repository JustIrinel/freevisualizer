'use strict';
// FreeVisualizer server: receives Art-Net / sACN and streams DMX to the browser
// (Server-Sent Events), serves the 3D app and stores projects. No dependencies.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { ArtNetReceiver, ipv4Interfaces } = require('./artnet');
const { SacnReceiver } = require('./sacn');
const { OflService } = require('./ofl');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.FREEVIS_DATA || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 8080);
const NO_OPEN = process.argv.includes('--no-open') || process.env.FREEVIS_NO_OPEN === '1';
const FLUSH_MS = 20;

fs.mkdirSync(path.join(DATA, 'projects'), { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ---------------------------------------------------------------- DMX state
const latest = new Map(); // "artnet:0" -> { data, source, dirty }
const clients = new Set();
const stats = { artnet: { packets: 0, polls: 0, error: null }, sacn: { packets: 0, error: null } };

function onDmx({ protocol, universe, data, source }) {
  const key = `${protocol}:${universe}`;
  const entry = latest.get(key) || { protocol, universe };
  entry.data = data;
  entry.source = source;
  entry.at = Date.now();
  entry.dirty = true;
  latest.set(key, entry);
  stats[protocol].packets++;
}

function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${payload}\n\n`;
  for (const res of clients) res.write(msg);
}

setInterval(() => {
  if (!clients.size) return;
  for (const e of latest.values()) {
    if (!e.dirty) continue;
    e.dirty = false;
    broadcast('dmx', `${e.protocol}|${e.universe}|${e.data.toString('base64')}`);
  }
}, FLUSH_MS);

setInterval(() => {
  const now = Date.now();
  const universes = [...latest.values()]
    .filter((e) => now - e.at < 3000)
    .map((e) => ({ protocol: e.protocol, universe: e.universe, source: e.source }));
  broadcast('status', JSON.stringify({ ...stats, universes, time: now }));
}, 1000);

// ---------------------------------------------------------------- receivers
const artnet = new ArtNetReceiver({ universesToAdvertise: 8 });
artnet.on('dmx', onDmx);
artnet.on('poll', () => stats.artnet.polls++);
artnet.on('error', (err) => { stats.artnet.error = err.message; });

const settingsFile = path.join(DATA, 'settings.json');
let settings = { sacnUniverses: [1, 2, 3, 4] };
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch (_) { /* defaults */ }

const sacn = new SacnReceiver({ universes: settings.sacnUniverses });
sacn.on('dmx', onDmx);
sacn.on('error', (err) => { stats.sacn.error = err.message; });

const ofl = new OflService(path.join(DATA, 'ofl-cache'));

// ---------------------------------------------------------------- http
function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeName(name) {
  const n = String(name || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 80);
  return n || null;
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    clients.add(res);
    // Send current state right away so a freshly opened tab is not dark.
    for (const e of latest.values()) res.write(`event: dmx\ndata: ${e.protocol}|${e.universe}|${e.data.toString('base64')}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (p === '/api/info') {
    const ifaces = ipv4Interfaces().filter((i) => !i.internal).map((i) => ({ name: i.name, address: i.address }));
    return sendJson(res, 200, { port: PORT, interfaces: ifaces, settings, stats });
  }

  if (p === '/api/settings' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    if (Array.isArray(body.sacnUniverses)) {
      settings.sacnUniverses = body.sacnUniverses.map(Number).filter((n) => n >= 1 && n <= 63999).slice(0, 64);
      sacn.joinUniverses(settings.sacnUniverses);
    }
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    return sendJson(res, 200, settings);
  }

  if (p === '/api/projects' && req.method === 'GET') {
    const list = fs.readdirSync(path.join(DATA, 'projects'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ name: f.slice(0, -5), modified: fs.statSync(path.join(DATA, 'projects', f)).mtimeMs }))
      .sort((a, b) => b.modified - a.modified);
    return sendJson(res, 200, list);
  }

  const projMatch = p.match(/^\/api\/projects\/(.+)$/);
  if (projMatch) {
    const name = safeName(decodeURIComponent(projMatch[1]));
    if (!name) return sendJson(res, 400, { error: 'Nume invalid' });
    const file = path.join(DATA, 'projects', `${name}.json`);
    if (req.method === 'GET') {
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'Proiectul nu există' });
      res.writeHead(200, { 'content-type': MIME['.json'] });
      return res.end(fs.readFileSync(file));
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      JSON.parse(body); // validate
      fs.writeFileSync(file, body);
      return sendJson(res, 200, { ok: true, name });
    }
    if (req.method === 'DELETE') {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (p === '/api/ofl/search') {
    try {
      return sendJson(res, 200, await ofl.search(url.searchParams.get('q')));
    } catch (err) {
      return sendJson(res, 502, { error: `Nu pot accesa Open Fixture Library (${err.message}). Verifică internetul sau importă fișierul .json manual.` });
    }
  }

  if (p === '/api/ofl/fixture') {
    try {
      return sendJson(res, 200, await ofl.fixture(url.searchParams.get('key') || ''));
    } catch (err) {
      return sendJson(res, 502, { error: `Nu pot descărca fixtura (${err.message}).` });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => sendJson(res, 500, { error: err.message }));
    return;
  }
  serveStatic(req, res, url.pathname);
});

function openBrowser(link) {
  const cmd = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open "${link}"` : `xdg-open "${link}"`;
  exec(cmd, () => {});
}

async function main() {
  try {
    await artnet.start();
  } catch (err) {
    stats.artnet.error = err.message;
    console.error(`[Art-Net] Nu pot asculta pe portul 6454: ${err.message}`);
    console.error('          Pornește FreeVisualizer ÎNAINTE de SoundSwitch sau închide alt vizualizator.');
  }
  try {
    await sacn.start();
  } catch (err) {
    stats.sacn.error = err.message;
    console.error(`[sACN] Nu pot asculta pe portul 5568: ${err.message}`);
  }
  server.listen(PORT, () => {
    const link = `http://localhost:${PORT}`;
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║        FreeVisualizer pornit cu succes        ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log(`  Deschide în browser:  ${link}`);
    console.log('  Art-Net:  UDP 6454 (SoundSwitch → Preferences → Hardware → Localhost Art-Net Node)');
    console.log(`  sACN:     UDP 5568 (universuri ${settings.sacnUniverses.join(', ')})`);
    const ifaces = ipv4Interfaces().filter((i) => !i.internal);
    if (ifaces.length) console.log(`  IP-uri rețea: ${ifaces.map((i) => i.address).join(', ')}`);
    console.log('  Oprește cu Ctrl+C.');
    console.log('');
    if (!NO_OPEN) openBrowser(link);
  });
}

main();

module.exports = { server };
