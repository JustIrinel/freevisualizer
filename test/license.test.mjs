import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLicense, deviceCode, normalizeDeviceCode, signLicense, verifyLicense, TRIAL_MS } = require('../server/license.js');
const { createKeyPair, issue, releaseDevice, createAdminStore } = require('../server/license-admin.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fvlic-'));
const kp = createKeyPair();
const other = createKeyPair();
const DEV = deviceCode('C0FFEE-UUID-1234');

test('device code is stable, formatted and forgiving when typed', () => {
  assert.match(DEV, /^FV-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.equal(deviceCode('c0ffee-uuid-1234 '), DEV);
  assert.notEqual(deviceCode('another machine'), DEV);
  assert.equal(normalizeDeviceCode(DEV.toLowerCase().replace(/-/g, ' ')), DEV);
  assert.equal(normalizeDeviceCode('FV-1234'), null);
});

test('keys verify only with the right public key and device', () => {
  const key = signLicense(kp.privateKey, { license: 'L0001', device: DEV, name: 'Ana Pop' });
  assert.equal(verifyLicense(key, kp.publicKey, DEV).ok, true);
  assert.equal(verifyLicense(`  ${key.slice(0, 30)}\n${key.slice(30)} `, kp.publicKey, DEV).ok, true, 'whitespace from chat apps is ignored');
  assert.equal(verifyLicense(key, other.publicKey, DEV).error, 'signature');
  assert.equal(verifyLicense(key, kp.publicKey, deviceCode('x')).error, 'device');
  assert.equal(verifyLicense('FVL1.abc', kp.publicKey, DEV).error, 'format');
  assert.equal(verifyLicense(key, '', DEV).error, 'nokey');
  // a changed payload breaks the signature
  const [h, p, s] = key.split('.');
  const forged = Buffer.from(Buffer.from(p, 'base64url').toString().replace('Ana Pop', 'Hacker')).toString('base64url');
  assert.equal(verifyLicense(`${h}.${forged}.${s}`, kp.publicKey, DEV).error, 'signature');
});

test('trial: 24 h, then limited; tampering and clock rollback end it', () => {
  const dir = tmp();
  const alt = path.join(tmp(), 'alt.dat');
  let t = 1_700_000_000_000;
  const lic = () => createLicense({ dir, altFile: alt, device: DEV, publicKey: kp.publicKey, now: () => t });
  assert.equal(lic().status().status, 'trial');
  assert.equal(lic().status().hoursLeft, 24);
  t += TRIAL_MS - 3600_000;
  assert.equal(lic().status().hoursLeft, 1);
  assert.equal(lic().allows('dmx'), true);
  t += 2 * 3600_000;
  const late = lic();
  assert.equal(late.status().status, 'limited');
  assert.equal(late.allows('dmx'), false);
  assert.equal(late.allows('clips'), false);
  assert.equal(late.allows('edit'), true);
  // deleting the main copy does not restart the trial (the second copy remembers)
  fs.unlinkSync(path.join(dir, '.trial'));
  assert.equal(lic().status().status, 'limited');
  // clock set back
  const d2 = tmp();
  let t2 = 1_700_000_000_000;
  createLicense({ dir: d2, device: DEV, publicKey: kp.publicKey, now: () => t2 }).status();
  t2 += 3600_000 * 3;
  createLicense({ dir: d2, device: DEV, publicKey: kp.publicKey, now: () => t2 }).status();
  t2 -= 3600_000 * 2;
  assert.equal(createLicense({ dir: d2, device: DEV, publicKey: kp.publicKey, now: () => t2 }).status().reason, 'clock');
  // edited file
  const d3 = tmp();
  createLicense({ dir: d3, device: DEV, publicKey: kp.publicKey }).status();
  const f = path.join(d3, '.trial');
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  r.f += TRIAL_MS * 10;
  fs.writeFileSync(f, JSON.stringify(r));
  assert.equal(createLicense({ dir: d3, device: DEV, publicKey: kp.publicKey }).status().status, 'limited');
});

test('activation unlocks and survives a restart', () => {
  const dir = tmp();
  let t = 1_700_000_000_000 + TRIAL_MS * 5;
  const lic = createLicense({ dir, device: DEV, publicKey: kp.publicKey, now: () => t });
  assert.equal(lic.activate('FVL1.nope.nope').ok, false);
  const wrongDevice = signLicense(kp.privateKey, { license: 'L0002', device: deviceCode('elsewhere'), name: 'X' });
  assert.equal(lic.activate(wrongDevice).error, 'device');
  const key = signLicense(kp.privateKey, { license: 'L0002', device: DEV, name: 'Ion' });
  const r = lic.activate(key);
  assert.equal(r.ok, true);
  assert.equal(r.status.status, 'active');
  assert.equal(r.status.licensee, 'Ion');
  t += TRIAL_MS * 100;
  const again = createLicense({ dir, device: DEV, publicKey: kp.publicKey, now: () => t });
  assert.equal(again.status().status, 'active');
  assert.equal(again.allows('dmx'), true);
});

test('generator: max 2 computers per license, free a seat, backup/restore', () => {
  const ledger = { licenses: [] };
  const a = issue(ledger, kp.privateKey, { name: 'Ana Pop', contact: '07…', device: DEV });
  assert.equal(a.license.id, 'L0001');
  assert.equal(verifyLicense(a.key, kp.publicKey, DEV).ok, true);
  const dev2 = deviceCode('laptop 2');
  issue(ledger, kp.privateKey, { licenseId: 'L0001', device: dev2 });
  // the same computer again just re-issues its key
  issue(ledger, kp.privateKey, { licenseId: 'L0001', device: DEV });
  assert.equal(ledger.licenses[0].devices.length, 2);
  assert.throws(() => issue(ledger, kp.privateKey, { licenseId: 'L0001', device: deviceCode('third') }), /deja 2 calculatoare/);
  assert.equal(releaseDevice(ledger, 'L0001', dev2), true);
  issue(ledger, kp.privateKey, { licenseId: 'L0001', device: deviceCode('third') });
  assert.equal(issue(ledger, kp.privateKey, { name: 'Bogdan', device: DEV }).license.id, 'L0002');
  assert.throws(() => issue(ledger, kp.privateKey, { name: '', device: DEV }), /numele/);
  assert.throws(() => issue(ledger, kp.privateKey, { name: 'X', device: 'FV-12' }), /nu e valid/);

  const store = createAdminStore(path.join(tmp(), 'admin'));
  assert.equal(store.exists(), false);
  const pub = store.setup();
  assert.match(pub, /BEGIN PUBLIC KEY/);
  const { key } = store.issue({ name: 'Client', device: DEV });
  assert.equal(verifyLicense(key, pub, DEV).ok, true);
  const backup = store.backup();
  const copy = createAdminStore(path.join(tmp(), 'admin2'));
  copy.restore(backup);
  assert.equal(copy.ledger().licenses.length, 1);
  assert.equal(verifyLicense(copy.issue({ licenseId: 'L0001', device: deviceCode('b') }).key, pub, deviceCode('b')).ok, true);
});
