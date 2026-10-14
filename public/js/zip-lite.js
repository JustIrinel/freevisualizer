// Minimal ZIP reader (stored + deflate) for .gdtf files, using the platform's
// DecompressionStream. Works in modern browsers, Electron and Node 18+.

/** @returns Map(fileName -> async () => Uint8Array) */
export function readZip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Fișierul nu este o arhivă validă (ZIP/GDTF)');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    files.set(name, async () => {
      const lnameLen = view.getUint16(localOffset + 26, true);
      const lextraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + lnameLen + lextraLen;
      const data = bytes.subarray(start, start + compSize);
      if (method === 0) return data.slice();
      if (method !== 8) throw new Error(`Compresie ZIP nesuportată (${method})`);
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    });
  }
  return files;
}

export async function readZipText(buffer, fileName) {
  const files = readZip(buffer);
  const key = [...files.keys()].find((k) => k.toLowerCase() === fileName.toLowerCase());
  if (!key) throw new Error(`Lipsește ${fileName} din arhivă`);
  return new TextDecoder().decode(await files.get(key)());
}
