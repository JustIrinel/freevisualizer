'use strict';
// FreeVisualizer server: receives Art-Net / sACN and streams DMX to the browser
// (Server-Sent Events), serves the 3D app and stores projects. No dependencies.
// Used both by the CLI (server/index.js) and by the desktop app (desktop/main.js).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ArtNetReceiver, ipv4Interfaces } = require('./artnet');
const { SacnReceiver } = require('./sacn');
const { OflService } = require('./ofl');

const PUBLIC = path.resolve(__dirname, '..', 'public');
const FLUSH_MS = 20;

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

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/** Raw request body as a Buffer (3D models, images). */
function readRaw(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Fișier prea mare')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const MODEL_EXT = { glb: 'model/gltf-binary', '3ds': 'application/octet-stream', png: 'image/png', jpg: 'image/jpeg' };
const MODEL_FILE = /^[a-f0-9]{40}\.(glb|3ds|png|jpg)$/;

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

function listen(server, port, host, attempts) {
  return new Promise((resolve, reject) => {
    const tryPort = (p, left) => {
      const onError = (err) => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && left > 0) tryPort(p + 1, left - 1);
        else reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve(server.address().port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, host);
    };
    tryPort(port, attempts);
  });
}

/**
 * @param opts.dataDir      where projects, settings and the OFL cache live
 * @param opts.port         preferred HTTP port (falls back to the next free one)
 * @param opts.portAttempts how many following ports to try when busy
 * @param opts.artnetPort / opts.sacnPort  UDP ports (tests use non-standard ones)
 */
function createApp(opts = {}) {
  const DATA = opts.dataDir;
  const portAttempts = opts.portAttempts ?? 20;
  fs.mkdirSync(path.join(DATA, 'projects'), { recursive: true });
  const MODELS = path.join(DATA, 'models');
  fs.mkdirSync(MODELS, { recursive: true });

  // -------------------------------------------------------------- DMX state
  const latest = new Map(); // "artnet:0" -> { data, source, dirty }
  const clients = new Set();
  const stats = { artnet: { packets: 0, polls: 0, error: null }, sacn: { packets: 0, error: null } };
  const timers = [];

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

  timers.push(setInterval(() => {
    if (!clients.size) return;
    for (const e of latest.values()) {
      if (!e.dirty) continue;
      e.dirty = false;
      broadcast('dmx', `${e.protocol}|${e.universe}|${e.data.toString('base64')}`);
    }
  }, FLUSH_MS));

  timers.push(setInterval(() => {
    const now = Date.now();
    const universes = [...latest.values()]
      .filter((e) => now - e.at < 3000)
      .map((e) => ({ protocol: e.protocol, universe: e.universe, source: e.source }));
    broadcast('status', JSON.stringify({ ...stats, universes, time: now }));
  }, 1000));

  // -------------------------------------------------------------- receivers
  const artnet = new ArtNetReceiver({ universesToAdvertise: 8, ...(opts.artnetPort ? { port: opts.artnetPort } : {}) });
  artnet.on('dmx', onDmx);
  artnet.on('poll', () => stats.artnet.polls++);
  artnet.on('error', (err) => { stats.artnet.error = err.message; });

  const settingsFile = path.join(DATA, 'settings.json');
  let settings = { sacnUniverses: [1, 2, 3, 4] };
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch (_) { /* defaults */ }

  const sacn = new SacnReceiver({ universes: settings.sacnUniverses, ...(opts.sacnPort ? { port: opts.sacnPort } : {}) });
  sacn.on('dmx', onDmx);
  sacn.on('error', (err) => { stats.sacn.error = err.message; });

  const ofl = new OflService(path.join(DATA, 'ofl-cache'));
  let port = null;

  // -------------------------------------------------------------- http
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
      return sendJson(res, 200, { port, interfaces: ifaces, settings, stats });
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

    // 3D models and thumbnails for profiles (from .glb uploads and GDTF files), stored by content hash.
    if (p === '/api/models' && req.method === 'POST') {
      const ext = String(url.searchParams.get('ext') || '').toLowerCase();
      if (!MODEL_EXT[ext]) return sendJson(res, 400, { error: 'Format nesuportat' });
      const buf = await readRaw(req);
      if (!buf.length) return sendJson(res, 400, { error: 'Fișier gol' });
      const file = `${crypto.createHash('sha1').update(buf).digest('hex')}.${ext}`;
      const dest = path.join(MODELS, file);
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
      return sendJson(res, 200, { file });
    }
    const modelMatch = /^\/api\/models\/([^/]+)$/.exec(p);
    if (modelMatch && req.method === 'GET') {
      const file = modelMatch[1];
      if (!MODEL_FILE.test(file)) return sendJson(res, 400, { error: 'Nume invalid' });
      const full = path.join(MODELS, file);
      if (!fs.existsSync(full)) return sendJson(res, 404, { error: 'Modelul nu există' });
      res.writeHead(200, { 'content-type': MODEL_EXT[file.split('.').pop()], 'cache-control': 'max-age=31536000, immutable' });
      fs.createReadStream(full).pipe(res);
      return undefined;
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

  async function start() {
    try {
      await artnet.start();
    } catch (err) {
      stats.artnet.error = err.message;
    }
    try {
      await sacn.start();
    } catch (err) {
      stats.sacn.error = err.message;
    }
    port = await listen(server, opts.port ?? 8080, opts.host, portAttempts);
    return { port, stats, settings };
  }

  async function stop() {
    for (const t of timers) clearInterval(t);
    for (const res of clients) res.end();
    clients.clear();
    artnet.stop();
    sacn.stop();
    await new Promise((r) => server.close(() => r()));
  }

  return { start, stop, stats, get port() { return port; }, get settings() { return settings; } };
}

module.exports = { createApp, ipv4Interfaces };
