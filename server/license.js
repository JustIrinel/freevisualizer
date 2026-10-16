'use strict';
// Licensing: 24 h free trial, then a key signed by DJ Matei unlocks the app on
// one computer. Keys are Ed25519 signatures over { license id, device code, name };
// the app only holds the public key, so keys can't be forged.
//
// Pure and injectable (paths, clock, keys) so it is tested in test/license.test.mjs.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TRIAL_MS = 24 * 60 * 60 * 1000;
const CLOCK_SLACK_MS = 60 * 60 * 1000; // clock set back by more than this = expired
const SALT = 'freevisualizer|djmatei.ro|v1';

// Public key of DJ Matei's license generator (Ctrl/Cmd+Shift+Alt+L → setup).
// Until it is set, no key can be activated.
const PUBLIC_KEY = '';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U

function base32(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** FV-XXXX-XXXX-XXXX from a stable machine id. */
function deviceCode(rawId) {
  const h = crypto.createHash('sha256').update(`${SALT}|device|${String(rawId).trim().toLowerCase()}`).digest();
  const s = base32(h).slice(0, 12);
  return `FV-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** Accept codes typed with spaces, lower case or O/I/L instead of 0/1. */
function normalizeDeviceCode(code) {
  const s = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^FV/, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 12 || [...s].some((c) => !B32.includes(c))) return null;
  return `FV-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** FVL1.<payload>.<signature> – payload { l: license id, d: device code, n: name, t: issued (ms) }. */
function signLicense(privateKeyPem, { license, device, name, issued = Date.now() }) {
  const code = normalizeDeviceCode(device);
  if (!code) throw new Error('Codul calculatorului nu e valid (FV-XXXX-XXXX-XXXX).');
  const payload = Buffer.from(JSON.stringify({ l: license, d: code, n: name || '', t: issued }));
  const sig = crypto.sign(null, payload, privateKeyPem);
  return `FVL1.${b64u(payload)}.${b64u(sig)}`;
}

/** { ok, payload } or { ok: false, error: 'format' | 'signature' | 'device' | 'nokey' }. */
function verifyLicense(key, publicKeyPem, device) {
  if (!publicKeyPem) return { ok: false, error: 'nokey' };
  const m = /^FVL1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(key || '').replace(/\s+/g, ''));
  if (!m) return { ok: false, error: 'format' };
  let payload;
  try {
    const raw = Buffer.from(m[1], 'base64url');
    if (!crypto.verify(null, raw, publicKeyPem, Buffer.from(m[2], 'base64url'))) return { ok: false, error: 'signature' };
    payload = JSON.parse(raw.toString('utf8'));
  } catch (_) {
    return { ok: false, error: 'format' };
  }
  if (payload.d !== device) return { ok: false, error: 'device', payload };
  return { ok: true, payload };
}

// ------------------------------------------------------------------ trial
function trialMac(device, first, last) {
  return crypto.createHmac('sha256', `${SALT}|trial|${device}`).update(`${first}|${last}`).digest('hex').slice(0, 32);
}

function readTrial(file, device) {
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof r.f !== 'number' || typeof r.s !== 'number' || r.m !== trialMac(device, r.f, r.s)) return { tampered: true };
    return { first: r.f, last: r.s };
  } catch (err) {
    return err.code === 'ENOENT' ? null : { tampered: true };
  }
}

function writeTrial(file, device, first, last) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ f: first, s: last, m: trialMac(device, first, last) }));
  } catch (_) { /* read-only location: the other copy still counts */ }
}

/**
 * License state for one computer.
 * @param {{ dir: string, altFile?: string, device: string, publicKey?: string, now?: () => number, config?: object }} o
 */
function createLicense(o) {
  const now = o.now || Date.now;
  const publicKey = o.publicKey ?? PUBLIC_KEY;
  const keyFile = path.join(o.dir, 'license.key');
  const trialFiles = [path.join(o.dir, '.trial'), o.altFile].filter(Boolean);
  let active = null;
  let cache = null;

  function loadKey() {
    try {
      const v = verifyLicense(fs.readFileSync(keyFile, 'utf8').trim(), publicKey, o.device);
      active = v.ok ? v.payload : null;
    } catch (_) { active = null; }
  }

  /** Earliest valid first-run time over every copy; tampering or clock rollback ends the trial. */
  function trial() {
    const t = now();
    const records = trialFiles.map((f) => readTrial(f, o.device));
    if (records.some((r) => r && r.tampered)) return { expired: true, reason: 'tampered' };
    const valid = records.filter(Boolean);
    const first = valid.length ? Math.min(...valid.map((r) => r.first)) : t;
    const last = Math.max(t, ...valid.map((r) => r.last));
    for (const f of trialFiles) writeTrial(f, o.device, first, last);
    if (t < last - CLOCK_SLACK_MS) return { expired: true, reason: 'clock', first };
    const left = first + TRIAL_MS - t;
    return { expired: left <= 0, left: Math.max(0, left), first };
  }

  loadKey();

  function status() {
    if (cache && now() - cache.at < 5000) return cache.value;
    let value;
    if (active) value = { status: 'active', licensee: active.n, license: active.l, device: o.device };
    else {
      const tr = trial();
      value = tr.expired
        ? { status: 'limited', device: o.device, reason: tr.reason || 'expired' }
        : { status: 'trial', device: o.device, hoursLeft: Math.ceil(tr.left / 3600000), msLeft: tr.left };
    }
    value.config = o.config || {};
    value.canActivate = !!publicKey;
    cache = { at: now(), value };
    return value;
  }

  /** What is allowed right now: everything during the trial or with a key; editing only otherwise. */
  function allows(feature) {
    const s = status().status;
    if (s !== 'limited') return true;
    return !['dmx', 'clips', 'present'].includes(feature);
  }

  function activate(key) {
    const v = verifyLicense(key, publicKey, o.device);
    if (!v.ok) return { ok: false, error: v.error };
    fs.mkdirSync(o.dir, { recursive: true });
    fs.writeFileSync(keyFile, String(key).replace(/\s+/g, ''));
    active = v.payload;
    cache = null;
    return { ok: true, status: status() };
  }

  return { status, allows, activate };
}

module.exports = { createLicense, deviceCode, normalizeDeviceCode, signLicense, verifyLicense, PUBLIC_KEY, TRIAL_MS };
