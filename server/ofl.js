'use strict';
// Open Fixture Library helper: search the catalogue and download fixture
// definitions. Everything is cached on disk so it keeps working offline at gigs.

const fs = require('fs');
const path = require('path');
const { tr } = require('./i18n');

const RAW = 'https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master';
const TREE = 'https://api.github.com/repos/OpenLightingProject/open-fixture-library/git/trees/master?recursive=1';
const OFL_SEARCH = 'https://open-fixture-library.org/api/v1/get-search-results';
const KEY_RE = /^[a-z0-9][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9-]*$/;
const INDEX_MAX_AGE = 7 * 24 * 3600 * 1000;

/** Fixture list shipped with the app (scripts/update-ofl-snapshot.sh). */
function snapshot() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'ofl-snapshot.json'), 'utf8'));
  } catch (_) {
    return { keys: [], manufacturers: {} };
  }
}

class OflService {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    fs.mkdirSync(path.join(cacheDir, 'fixtures'), { recursive: true });
    this.index = null; // [{ key, manufacturer, name }]
  }

  async _fetch(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { 'user-agent': 'FreeVisualizer', ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res;
  }

  _readCache(file, maxAge) {
    try {
      const st = fs.statSync(file);
      if (maxAge && Date.now() - st.mtimeMs > maxAge) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      return null;
    }
  }

  async _manufacturers() {
    const file = path.join(this.cacheDir, 'manufacturers.json');
    let data = this._readCache(file, INDEX_MAX_AGE);
    if (!data) {
      try {
        data = await (await this._fetch(`${RAW}/fixtures/manufacturers.json`)).json();
        fs.writeFileSync(file, JSON.stringify(data));
      } catch (err) {
        data = this._readCache(file, 0) || snapshot().manufacturers;
      }
    }
    return data;
  }

  async _buildIndex() {
    if (this.index) return this.index;
    const file = path.join(this.cacheDir, 'index.json');
    let keys = this._readCache(file, INDEX_MAX_AGE);
    if (!keys) {
      try {
        const tree = await (await this._fetch(TREE, { headers: { accept: 'application/vnd.github+json' } })).json();
        keys = (tree.tree || [])
          .map((t) => t.path)
          .filter((p) => /^fixtures\/[^/]+\/[^/]+\.json$/.test(p) && !p.endsWith('manufacturers.json'))
          .map((p) => p.slice('fixtures/'.length, -'.json'.length));
        if (keys.length) fs.writeFileSync(file, JSON.stringify(keys));
      } catch (err) {
        // GitHub API unreachable or rate limited: last cached list, then the shipped one.
        keys = this._readCache(file, 0) || snapshot().keys;
      }
    }
    if (!keys || !keys.length) return null;
    const mans = await this._manufacturers();
    this.index = keys.map((key) => {
      const [man, fix] = key.split('/');
      return { key, manufacturer: (mans[man] && mans[man].name) || man, name: prettify(fix) };
    });
    return this.index;
  }

  async search(query) {
    const q = String(query || '').toLowerCase().trim();
    if (q.length < 2) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    const index = await this._buildIndex();
    if (index) {
      return index
        .filter((f) => {
          const hay = `${f.key} ${f.manufacturer} ${f.name}`.toLowerCase();
          return tokens.every((t) => hay.includes(t));
        })
        .slice(0, 80);
    }
    // Fallback: the official OFL search API.
    const res = await this._fetch(OFL_SEARCH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ searchQuery: q, manufacturersQuery: [], categoriesQuery: [] }),
    });
    const list = await res.json();
    const mans = await this._manufacturers();
    return (Array.isArray(list) ? list : [])
      .map((k) => (typeof k === 'string' ? k : k.key))
      .filter((k) => KEY_RE.test(k || ''))
      .slice(0, 80)
      .map((key) => {
        const [man, fix] = key.split('/');
        return { key, manufacturer: (mans[man] && mans[man].name) || man, name: prettify(fix) };
      });
  }

  async fixture(key, lang) {
    if (!KEY_RE.test(key)) throw new Error(tr(lang, 'Cheie de fixtură invalidă'));
    const file = path.join(this.cacheDir, 'fixtures', key.replace('/', '__') + '.json');
    const cached = this._readCache(file, 0);
    if (cached) return cached;
    let data;
    try {
      data = await (await this._fetch(`${RAW}/fixtures/${key}.json`)).json();
    } catch (err) {
      data = await (await this._fetch(`https://open-fixture-library.org/${key}.json`)).json();
    }
    const mans = await this._manufacturers();
    const man = key.split('/')[0];
    data.__key = key;
    data.__manufacturer = (mans[man] && mans[man].name) || man;
    fs.writeFileSync(file, JSON.stringify(data));
    return data;
  }
}

function prettify(slug) {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

module.exports = { OflService };
