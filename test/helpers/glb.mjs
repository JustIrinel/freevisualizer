// Minimal glTF binary writer for tests: named box meshes in a node hierarchy.
const BOX_POS = [
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
];
const BOX_IDX = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3];

/**
 * nodes: [{ name, translation:[x,y,z], scale:[x,y,z], parent: index|undefined }]
 * Every node gets the unit box mesh.
 */
export function makeGlb(nodes) {
  const pos = Buffer.from(new Float32Array(BOX_POS).buffer);
  const idx = Buffer.from(new Uint16Array(BOX_IDX).buffer);
  const bin = Buffer.concat([pos, idx]);
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: nodes.map((n, i) => (n.parent == null ? i : -1)).filter((i) => i >= 0) }],
    nodes: nodes.map((n, i) => ({
      name: n.name, mesh: 0, translation: n.translation || [0, 0, 0], scale: n.scale || [1, 1, 1],
      ...(nodes.some((c) => c.parent === i) ? { children: nodes.map((c, j) => (c.parent === i ? j : -1)).filter((j) => j >= 0) } : {}),
    })),
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.2, 0.2, 0.22, 1], metallicFactor: 0.3, roughnessFactor: 0.6 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: idx.length }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5123, count: BOX_IDX.length, type: 'SCALAR' },
    ],
  };
  let json = Buffer.from(JSON.stringify(gltf));
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const binPadded = bin.length % 4 ? Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]) : bin;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binPadded.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binPadded.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, json, bh, binPadded]);
}

/** A moving head as one .glb with parts named Base / Yoke / Head (Y up, standing). */
export function movingHeadGlb() {
  return makeGlb([
    { name: 'Base', translation: [0, 0.05, 0], scale: [0.3, 0.1, 0.25] },
    { name: 'Yoke', translation: [0, 0.25, 0], scale: [0.32, 0.3, 0.08] },
    { name: 'Head', translation: [0, 0.3, 0], scale: [0.18, 0.28, 0.18] },
  ]);
}

/** 1×1 PNG. */
export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** GDTF description with Base → Axis Yoke → Axis Head → Beam and three models. */
export function gdtfDescription() {
  const m = (r) => `{1,0,0,0}{0,1,0,0}{0,0,1,${r}}{0,0,0,1}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2"><FixtureType Name="Test Beam 3D" LongName="Test Beam 3D" Manufacturer="Test" FixtureTypeID="X">
  <Models>
    <Model Name="Base" File="base" Length="0.3" Width="0.25" Height="0.1"/>
    <Model Name="Yoke" File="yoke" Length="0.32" Width="0.08" Height="0.3"/>
    <Model Name="Head" File="head" Length="0.18" Width="0.18" Height="0.28"/>
  </Models>
  <Geometries>
    <Geometry Name="Base" Model="Base" Position="${m(0)}">
      <Axis Name="Yoke" Model="Yoke" Position="${m(-0.2)}">
        <Axis Name="Head" Model="Head" Position="${m(-0.08)}">
          <Beam Name="Beam" Position="${m(-0.14)}" BeamAngle="4"/>
        </Axis>
      </Axis>
    </Geometry>
  </Geometries>
  <DMXModes><DMXMode Name="Basic" Geometry="Base"><DMXChannels>
    <DMXChannel Offset="1" Geometry="Yoke"><LogicalChannel Attribute="Pan"><ChannelFunction Attribute="Pan" DMXFrom="0/1" PhysicalFrom="-270" PhysicalTo="270"/></LogicalChannel></DMXChannel>
    <DMXChannel Offset="2" Geometry="Head"><LogicalChannel Attribute="Tilt"><ChannelFunction Attribute="Tilt" DMXFrom="0/1" PhysicalFrom="-135" PhysicalTo="135"/></LogicalChannel></DMXChannel>
    <DMXChannel Offset="3" Geometry="Head"><LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer" DMXFrom="0/1"/></LogicalChannel></DMXChannel>
  </DMXChannels></DMXMode></DMXModes>
</FixtureType></GDTF>`;
}

/** Unit box .glb (single part of a GDTF). */
export function boxGlb() {
  return makeGlb([{ name: 'Part' }]);
}
