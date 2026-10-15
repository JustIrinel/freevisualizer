import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { parseXml, child, children } from '../public/js/xml-lite.js';
import { readZip, fixtureFilesInZip } from '../public/js/zip-lite.js';
import { parseD4, listD4Modes, d4ToProfile, isD4Xml } from '../public/js/d4-import.js';
import { readGdtf, listGdtfModes, gdtfToProfile, cieToHex, gdtfGeometry, gdtfAssets } from '../public/js/gdtf-import.js';
import { gdtfDescription, boxGlb, PNG_1PX } from './helpers/glb.mjs';
import { parseQxf, listQxfModes, qxfToProfile } from '../public/js/qxf-import.js';
import { computeState, createRuntime } from '../public/js/fixture-state.js';
import { normalizeProfile } from '../public/js/profiles.js';
import { aimRotation, beamDirection } from '../public/js/aim.js';

const d4 = (n) => fs.readFileSync(new URL(`./d4/${n}`, import.meta.url), 'utf8');
const qxf = (n) => fs.readFileSync(new URL(`./qxf/${n}`, import.meta.url), 'utf8');
const dmx = (values) => { const b = new Uint8Array(512); values.forEach((v, i) => { b[i] = v; }); return b; };

/** Build a ZIP (deflate) in memory, like a .gdtf file. */
function makeZip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const raw = Buffer.from(text);
    const data = zlib.deflateRawSync(raw);
    const crc = zlib.crc32 ? zlib.crc32(raw) : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc >>> 0, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

const GDTF = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<GDTF DataVersion="1.2">
  <FixtureType Name="Test Spot" LongName="Test Spot 300" Manufacturer="Acme" FixtureTypeID="1">
    <Wheels>
      <Wheel Name="Color Wheel">
        <Slot Name="Open" Color="0.312700,0.329000,100.000000"/>
        <Slot Name="Red" Color="0.640000,0.330000,21.260000"/>
        <Slot Name="Blue" Color="0.150000,0.060000,7.220000"/>
      </Wheel>
      <Wheel Name="Gobo Wheel"><Slot Name="Open"/><Slot Name="Dots"/><Slot Name="Star"/></Wheel>
    </Wheels>
    <Geometries>
      <Geometry Name="Base">
        <Axis Name="Yoke"><Axis Name="Head"><Beam Name="Beam" BeamAngle="18.000000"/></Axis></Axis>
      </Geometry>
      <Geometry Name="Bar">
        <Geometry Name="Pixel"><Beam Name="PixelBeam" BeamAngle="25"/></Geometry>
        <GeometryReference Name="Pixel 1" Geometry="Pixel"><Break DMXBreak="1" DMXOffset="2"/></GeometryReference>
        <GeometryReference Name="Pixel 2" Geometry="Pixel"><Break DMXBreak="1" DMXOffset="5"/></GeometryReference>
        <GeometryReference Name="Pixel 3" Geometry="Pixel"><Break DMXBreak="1" DMXOffset="8"/></GeometryReference>
      </Geometry>
    </Geometries>
    <DMXModes>
      <DMXMode Name="Standard" Geometry="Base">
        <DMXChannels>
          <DMXChannel DMXBreak="1" Offset="1,2" Geometry="Yoke">
            <LogicalChannel Attribute="Pan"><ChannelFunction Name="Pan" Attribute="Pan" DMXFrom="0/2" PhysicalFrom="-270" PhysicalTo="270"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Offset="3,4" Geometry="Head">
            <LogicalChannel Attribute="Tilt"><ChannelFunction Name="Tilt" Attribute="Tilt" DMXFrom="0/2" PhysicalFrom="-135" PhysicalTo="135"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Offset="5" Geometry="Beam">
            <LogicalChannel Attribute="Dimmer"><ChannelFunction Name="Dimmer" Attribute="Dimmer" DMXFrom="0/1"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Offset="6" Geometry="Beam">
            <LogicalChannel Attribute="Color1">
              <ChannelFunction Name="Wheel" Attribute="Color1" DMXFrom="0/1" Wheel="Color Wheel">
                <ChannelSet Name="Open" DMXFrom="0/1" WheelSlotIndex="1"/>
                <ChannelSet Name="Red" DMXFrom="20/1" WheelSlotIndex="2"/>
                <ChannelSet Name="Blue" DMXFrom="40/1" WheelSlotIndex="3"/>
              </ChannelFunction>
              <ChannelFunction Name="Spin" Attribute="Color1WheelSpin" DMXFrom="128/1"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Offset="7" Geometry="Beam">
            <LogicalChannel Attribute="Gobo1">
              <ChannelFunction Name="Gobo" Attribute="Gobo1" DMXFrom="0/1" Wheel="Gobo Wheel">
                <ChannelSet Name="Open" DMXFrom="0/1" WheelSlotIndex="1"/>
                <ChannelSet Name="Dots" DMXFrom="10/1" WheelSlotIndex="2"/>
                <ChannelSet Name="Star" DMXFrom="20/1" WheelSlotIndex="3"/>
              </ChannelFunction>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Offset="8" Geometry="Beam">
            <LogicalChannel Attribute="Shutter1">
              <ChannelFunction Name="Closed" Attribute="Shutter1" DMXFrom="0/1"/>
              <ChannelFunction Name="Open" Attribute="Shutter1" DMXFrom="8/1"/>
              <ChannelFunction Name="Strobe" Attribute="Shutter1Strobe" DMXFrom="16/1" PhysicalFrom="1" PhysicalTo="25"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Offset="9" Geometry="Beam">
            <LogicalChannel Attribute="Zoom"><ChannelFunction Name="Zoom" Attribute="Zoom" DMXFrom="0/1" PhysicalFrom="10" PhysicalTo="40"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Offset="" Geometry="Beam">
            <LogicalChannel Attribute="Dimmer"/>
          </DMXChannel>
        </DMXChannels>
      </DMXMode>
      <DMXMode Name="Pixel" Geometry="Bar">
        <DMXChannels>
          <DMXChannel DMXBreak="1" Offset="1" Geometry="Bar"><LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer" DMXFrom="0/1"/></LogicalChannel></DMXChannel>
          <DMXChannel DMXBreak="1" Offset="1" Geometry="Pixel"><LogicalChannel Attribute="ColorAdd_R"><ChannelFunction Attribute="ColorAdd_R" DMXFrom="0/1"/></LogicalChannel></DMXChannel>
          <DMXChannel DMXBreak="1" Offset="2" Geometry="Pixel"><LogicalChannel Attribute="ColorAdd_G"><ChannelFunction Attribute="ColorAdd_G" DMXFrom="0/1"/></LogicalChannel></DMXChannel>
          <DMXChannel DMXBreak="1" Offset="3" Geometry="Pixel"><LogicalChannel Attribute="ColorAdd_B"><ChannelFunction Attribute="ColorAdd_B" DMXFrom="0/1"/></LogicalChannel></DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`;

test('xml-lite parses attributes, nesting, entities and self-closing tags', () => {
  const root = parseXml('<?xml version="1.0"?><!-- c --><A x="1 &amp; 2"><B y=\'3\'/><C>t&lt;x</C></A>');
  assert.strictEqual(root.name, 'A');
  assert.strictEqual(root.attrs.x, '1 & 2');
  assert.strictEqual(child(root, 'B').attrs.y, '3');
  assert.strictEqual(child(root, 'C').text, 't<x');
  assert.strictEqual(children(root, 'B').length, 1);
});

test('zip-lite reads deflated entries', async () => {
  const files = readZip(makeZip({ 'a.txt': 'hello', 'dir/b.txt': 'world '.repeat(50) }));
  assert.deepStrictEqual([...files.keys()], ['a.txt', 'dir/b.txt']);
  assert.strictEqual(new TextDecoder().decode(await files.get('dir/b.txt')()), 'world '.repeat(50));
});

test('GDTF moving head: 16-bit pan/tilt, color wheel, gobos, shutter, zoom', async () => {
  const ft = await readGdtf(makeZip({ 'description.xml': GDTF }));
  const modes = listGdtfModes(ft);
  assert.deepStrictEqual(modes.map((m) => [m.name, m.channels]), [['Standard', 9], ['Pixel', 10]]);
  const p = normalizeProfile(gdtfToProfile(ft, 0));
  assert.strictEqual(p.kind, 'moving');
  assert.strictEqual(p.manufacturer, 'Acme');
  assert.deepStrictEqual(p.channels.map((c) => c.type), ['pan', 'panFine', 'tilt', 'tiltFine', 'dimmer', 'colorWheel', 'gobo', 'strobe', 'zoom']);
  assert.strictEqual(p.panRange, 540);
  assert.strictEqual(p.tiltRange, 270);
  assert.deepStrictEqual(p.beamAngle, [10, 40]);
  const wheel = p.channels[5].ranges;
  assert.strictEqual(wheel.find((r) => r.from === 20).color, '#ff0000');
  assert.ok(wheel.some((r) => r.mode === 'rotate' && r.from === 128));
  const shutter = p.channels[7].ranges;
  assert.deepStrictEqual(shutter.map((r) => r.mode), ['closed', 'open', 'strobe']);
  // Red slot, dimmer full, shutter open → red light at full.
  const s = computeState(p, dmx([128, 0, 128, 0, 255, 25, 0, 10, 0]), 1, createRuntime(), 0.016, 0);
  assert.deepStrictEqual(s.color, [1, 0, 0]);
  assert.strictEqual(s.intensity, 1);
});

test('GDTF pixel bar: channels repeated through GeometryReference breaks', async () => {
  const ft = await readGdtf(makeZip({ 'description.xml': GDTF }));
  const p = gdtfToProfile(ft, 1);
  assert.strictEqual(p.kind, 'bar');
  assert.strictEqual(p.pixels, 3);
  assert.deepStrictEqual(p.channels.map((c) => c.type + (c.pixel != null ? c.pixel : '')), ['dimmer', 'red0', 'green0', 'blue0', 'red1', 'green1', 'blue1', 'red2', 'green2', 'blue2']);
});

test('CIE xyY colors convert to sRGB', () => {
  assert.strictEqual(cieToHex('0.3127,0.3290,100'), '#ffffff');
  assert.strictEqual(cieToHex('0.64,0.33,21.26'), '#ff0000');
});

test('QLC+ moving head (Chauvet Intimidator Spot 255 IRC)', () => {
  const root = parseQxf(qxf('Chauvet-Intimidator-Spot-255-IRC.qxf'));
  const modes = listQxfModes(root);
  const full = modes.find((m) => m.channels === 13);
  const p = qxfToProfile(root, full.index);
  assert.strictEqual(p.kind, 'moving');
  assert.strictEqual(p.manufacturer, 'Chauvet');
  assert.deepStrictEqual(p.channels.slice(0, 4).map((c) => c.type), ['pan', 'panFine', 'tilt', 'tiltFine']);
  const wheel = p.channels.find((c) => c.type === 'colorWheel');
  assert.strictEqual(wheel.ranges.find((r) => r.from === 7).color, '#ffc600');
  const shutter = p.channels.find((c) => c.type === 'strobe');
  assert.deepStrictEqual(shutter.ranges.map((r) => r.mode), ['closed', 'open', 'strobe', 'open']);
});

test('QLC+ pixel bar uses <Head> as pixels', () => {
  const root = parseQxf(qxf('Chauvet-ColorBand-Pix-M.qxf'));
  const m = listQxfModes(root).find((x) => x.name === '8 Channel');
  const p = qxfToProfile(root, m.index);
  assert.strictEqual(p.kind, 'bar');
  assert.strictEqual(p.pixels, 2);
  assert.deepStrictEqual(p.channels.slice(0, 6).map((c) => `${c.type}${c.pixel}`), ['red0', 'green0', 'blue0', 'red1', 'green1', 'blue1']);
});

test('QLC+ par with a Speed-group "Stroboscope" channel keeps 0 = no strobe', () => {
  const root = parseQxf(qxf('Cameo-LED-Mini-PAR-CAN-RGBW-7x8W.qxf'));
  const m = listQxfModes(root).find((x) => x.channels === 7);
  const p = normalizeProfile(qxfToProfile(root, m.index));
  assert.ok(p.channels.some((c) => c.type === 'strobe'));
  const idx = p.channels.map((c) => c.type);
  const values = idx.map((t) => (t === 'dimmer' || t === 'red' ? 255 : 0));
  const s = computeState(p, dmx(values), 1, createRuntime(), 0.016, 0);
  assert.strictEqual(s.intensity, 1);
  assert.deepStrictEqual(s.color, [1, 0, 0]);
});

test('aimRotation points +Y at the target', () => {
  const from = { x: 1, y: 0.2, z: -9 };
  const to = { x: -3, y: 4, z: -2 };
  const d = beamDirection(aimRotation(from, to));
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  assert.ok(Math.abs(d.x - (to.x - from.x) / len) < 0.01);
  assert.ok(Math.abs(d.y - (to.y - from.y) / len) < 0.01);
  assert.ok(Math.abs(d.z - (to.z - from.z) / len) < 0.01);
});

test('Avolites .d4 moving head: 16-bit pan/tilt/dimmer, wheel, gobo, shutter, modes', () => {
  const text = d4('Test-Spot-260.d4');
  assert.ok(isD4Xml(text));
  const root = parseD4(text);
  assert.deepStrictEqual(listD4Modes(root).map((m) => [m.name, m.channels]), [['16 Channel', 13], ['8 Channel', 8]]);
  const p = normalizeProfile(d4ToProfile(root, 0));
  assert.strictEqual(p.kind, 'moving');
  assert.strictEqual(p.manufacturer, 'Test Lighting');
  assert.deepStrictEqual(p.beamAngle, [12, 25]);
  assert.deepStrictEqual(p.channels.map((c) => c.type),
    ['pan', 'panFine', 'tilt', 'tiltFine', 'none', 'colorWheel', 'gobo', 'none', 'prism', 'zoom', 'strobe', 'dimmer', 'dimmerFine']);
  const wheel = p.channels[5].ranges;
  assert.strictEqual(wheel.find((r) => r.from === 10).color, '#ff0000');
  assert.strictEqual(wheel.find((r) => r.from === 128).mode, 'rotate');
  const shutter = p.channels[10].ranges;
  assert.deepStrictEqual(shutter.map((r) => r.mode), ['closed', 'open', 'strobe', 'pulse', 'random', 'open']);
  // Full dimmer, open shutter, red slot → red light.
  const v = new Array(13).fill(0); v[11] = 255; v[12] = 255; v[10] = 10; v[5] = 12;
  const s = computeState(p, dmx(v), 1, createRuntime(), 0.016, 0);
  assert.ok(s.intensity > 0.99);
  assert.deepStrictEqual(s.color, [1, 0, 0]);
  // 8-channel mode keeps the gap at offset 4.
  const p8 = d4ToProfile(root, 1);
  assert.deepStrictEqual(p8.channels.map((c) => c.type), ['pan', 'tilt', 'colorWheel', 'gobo', 'none', 'strobe', 'dimmer', 'zoom']);
});

test('Avolites .d4 with cells becomes a 7-pixel retro (offsets starting at 1)', () => {
  const p = d4ToProfile(parseD4(d4('Test-Retro-Hex-7.d4')), 0);
  assert.strictEqual(p.kind, 'retro');
  assert.strictEqual(p.pixels, 7);
  assert.strictEqual(p.channels.length, 22);
  assert.strictEqual(p.channels[0].type, 'dimmer');
  assert.deepStrictEqual([p.channels[1].type, p.channels[1].pixel, p.channels[21].type, p.channels[21].pixel], ['red', 0, 'blue', 6]);
});

test('.zip download: fixture files are found inside', async () => {
  const zip = makeZip({ 'Test/Test-Spot-260.d4': d4('Test-Spot-260.d4'), 'readme.txt': 'x', '__MACOSX/._Test-Spot-260.d4': 'junk' });
  const files = await fixtureFilesInZip(zip);
  assert.deepStrictEqual(files.map((f) => f.name), ['Test-Spot-260.d4']);
  assert.ok(isD4Xml(new TextDecoder().decode(files[0].bytes)));
});

test('GDTF 3D: geometry tree, model files and thumbnail are found', async () => {
  const zip = makeZip({
    'description.xml': gdtfDescription(),
    'models/gltf/base.glb': boxGlb(), 'models/gltf/yoke.glb': boxGlb(), 'models/3ds/head.3ds': Buffer.from('3ds'),
    'thumbnail.png': PNG_1PX,
  });
  const ft = await readGdtf(zip);
  const geo = gdtfGeometry(ft);
  assert.deepStrictEqual(Object.keys(geo.models), ['Base', 'Yoke', 'Head']);
  assert.strictEqual(geo.tree[0].name, 'Base');
  const yoke = geo.tree[0].children[0];
  assert.deepStrictEqual([yoke.tag, yoke.name, yoke.matrix[11]], ['Axis', 'Yoke', -0.2]);
  assert.strictEqual(yoke.children[0].children[0].tag, 'Beam');
  const assets = await gdtfAssets(zip, ft);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(assets.files).map(([k, v]) => [k, v.ext])), { Base: 'glb', Yoke: 'glb', Head: '3ds' });
  assert.ok(assets.thumbnail && assets.thumbnail.length === PNG_1PX.length);
  const p = gdtfToProfile(ft, 0);
  assert.strictEqual(p.kind, 'moving');
});
