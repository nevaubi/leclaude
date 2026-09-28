/**
 * Minimal synchronous ZIP reader/writer for OOXML packages (store + deflate,
 * no zip64, no encryption). Synchronous so `exportXlsx()` keeps its sync
 * contract; entries copied from an original package keep their exact
 * compressed bytes, so untouched parts are byte-identical inside the new file.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  crc: number;
  size: number;
  compressed: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = new TextEncoder();
const utf8d = new TextDecoder("utf-8");

/** Read every entry of a ZIP archive (central directory is authoritative). */
export function readZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP package (no end of central directory)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (p === 0xffffffff) throw new Error("ZIP64 packages are not supported");
  const out = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt ZIP central directory");
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = utf8d.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (flags & 1) throw new Error("Encrypted packages are not supported");
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    out.set(name, { name, method, crc, size, compressed: bytes.subarray(start, start + csize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function entryBytes(e: ZipEntry): Uint8Array {
  if (e.method === 0) return e.compressed;
  if (e.method === 8) return new Uint8Array(inflateRawSync(e.compressed));
  throw new Error(`Unsupported ZIP compression method ${e.method} for ${e.name}`);
}

export function entryText(e: ZipEntry): string {
  return utf8d.decode(entryBytes(e));
}

/** A new entry from uncompressed data (deflated unless tiny). */
export function makeEntry(name: string, data: Uint8Array | string): ZipEntry {
  const raw = typeof data === "string" ? utf8.encode(data) : data;
  const crc = crc32(raw);
  if (raw.length < 64) return { name, method: 0, crc, size: raw.length, compressed: raw };
  return { name, method: 8, crc, size: raw.length, compressed: new Uint8Array(deflateRawSync(raw, { level: 6 })) };
}

/** Write entries in the given order. Timestamps are fixed (1980-01-01) so output is deterministic. */
export function writeZip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1;
  for (const e of entries) {
    const name = utf8.encode(e.name);
    const lh = new Uint8Array(30 + name.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true); // UTF-8 names
    l.setUint16(8, e.method, true);
    l.setUint16(10, DOS_TIME, true);
    l.setUint16(12, DOS_DATE, true);
    l.setUint32(14, e.crc, true);
    l.setUint32(18, e.compressed.length, true);
    l.setUint32(22, e.size, true);
    l.setUint16(26, name.length, true);
    l.setUint16(28, 0, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, e.method, true);
    c.setUint16(12, DOS_TIME, true);
    c.setUint16(14, DOS_DATE, true);
    c.setUint32(16, e.crc, true);
    c.setUint32(20, e.compressed.length, true);
    c.setUint32(24, e.size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    ch.set(name, 46);
    chunks.push(lh, e.compressed);
    central.push(ch);
    offset += lh.length + e.compressed.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true);
  d.setUint16(8, entries.length, true);
  d.setUint16(10, entries.length, true);
  d.setUint32(12, cdSize, true);
  d.setUint32(16, offset, true);
  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of [...chunks, ...central, end]) { out.set(c, p); p += c.length; }
  return out;
}
