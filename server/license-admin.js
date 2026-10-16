'use strict';
// License generator for DJ Matei only: the key pair and the list of customers
// live in <userData>/license-admin/ on his computer and never leave it.
// One license = one customer = at most MAX_DEVICES computers.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { signLicense, normalizeDeviceCode } = require('./license');

const MAX_DEVICES = 2;

function createKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

function nextLicenseId(ledger) {
  const n = ledger.licenses.reduce((m, l) => Math.max(m, Number(String(l.id).replace(/\D/g, '')) || 0), 0) + 1;
  return `L${String(n).padStart(4, '0')}`;
}

/**
 * Issue a key for one computer. A new license when `licenseId` is empty,
 * otherwise a further computer of that license (max 2).
 * Returns { key, license } or throws with a message for the admin page.
 */
function issue(ledger, privateKey, { licenseId, name, contact, device, now = Date.now() }) {
  const code = normalizeDeviceCode(device);
  if (!code) throw new Error('Codul calculatorului nu e valid. Trebuie să arate ca FV-XXXX-XXXX-XXXX.');
  let lic = licenseId ? ledger.licenses.find((l) => l.id === licenseId) : null;
  if (licenseId && !lic) throw new Error(`Licența ${licenseId} nu există.`);
  if (!lic) {
    if (!String(name || '').trim()) throw new Error('Scrie numele clientului.');
    lic = { id: nextLicenseId(ledger), name: String(name).trim(), contact: String(contact || '').trim(), created: now, devices: [] };
    ledger.licenses.push(lic);
  }
  const existing = lic.devices.find((d) => d.code === code);
  if (!existing && lic.devices.length >= MAX_DEVICES) {
    throw new Error(`Licența ${lic.id} (${lic.name}) are deja ${MAX_DEVICES} calculatoare. Eliberează un loc dacă și-a schimbat calculatorul.`);
  }
  const key = signLicense(privateKey, { license: lic.id, device: code, name: lic.name, issued: now });
  if (existing) existing.key = key;
  else lic.devices.push({ code, date: now, key });
  return { key, license: lic };
}

function releaseDevice(ledger, licenseId, code) {
  const lic = ledger.licenses.find((l) => l.id === licenseId);
  if (!lic) return false;
  const before = lic.devices.length;
  lic.devices = lic.devices.filter((d) => d.code !== code);
  return lic.devices.length < before;
}

/** File storage in <dir>: private.pem, public.pem, ledger.json. */
function createAdminStore(dir) {
  const file = (n) => path.join(dir, n);
  const exists = () => fs.existsSync(file('private.pem'));
  const read = (n) => fs.readFileSync(file(n), 'utf8');
  const ledger = () => {
    try { return JSON.parse(read('ledger.json')); } catch (_) { return { licenses: [] }; }
  };
  const saveLedger = (l) => fs.writeFileSync(file('ledger.json'), JSON.stringify(l, null, 2), { mode: 0o600 });
  return {
    dir,
    exists,
    setup() {
      if (exists()) return read('public.pem');
      fs.mkdirSync(dir, { recursive: true });
      const kp = createKeyPair();
      fs.writeFileSync(file('private.pem'), kp.privateKey, { mode: 0o600 });
      fs.writeFileSync(file('public.pem'), kp.publicKey);
      saveLedger({ licenses: [] });
      return kp.publicKey;
    },
    publicKey: () => (exists() ? read('public.pem') : null),
    ledger,
    issue(input) {
      const l = ledger();
      const out = issue(l, read('private.pem'), input);
      saveLedger(l);
      return out;
    },
    release(licenseId, code) {
      const l = ledger();
      const ok = releaseDevice(l, licenseId, code);
      if (ok) saveLedger(l);
      return ok;
    },
    /** Everything needed to restore the generator on another computer. */
    backup: () => JSON.stringify({ kind: 'freevisualizer-license-admin', version: 1, privateKey: read('private.pem'), publicKey: read('public.pem'), ledger: ledger() }, null, 2),
    restore(json) {
      const b = JSON.parse(json);
      if (b.kind !== 'freevisualizer-license-admin' || !b.privateKey) throw new Error('Fișierul nu e un backup al generatorului.');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file('private.pem'), b.privateKey, { mode: 0o600 });
      fs.writeFileSync(file('public.pem'), b.publicKey);
      saveLedger(b.ledger || { licenses: [] });
    },
  };
}

module.exports = { createKeyPair, issue, releaseDevice, createAdminStore, MAX_DEVICES };
