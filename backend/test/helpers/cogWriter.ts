/**
 * Writes small Cloud-Optimized-GeoTIFF-style files for tests: classic
 * little-endian TIFF, tiled, float32, deflate (predictor 1 or 3), the
 * full-resolution image first and overviews after it, georeferenced with
 * ModelPixelScale / ModelTiepoint and a GDAL nodata value.
 */

import * as zlib from 'zlib';

export interface TestImage {
  width: number;
  height: number;
  tileSize: number;
  values: Float32Array; // row-major, north row first
}

interface Entry { tag: number; type: number; count: number; data: Buffer }

const SHORT = 3;
const LONG = 4;
const ASCII = 2;
const DOUBLE = 12;

function shorts(...v: number[]): Buffer { const b = Buffer.alloc(v.length * 2); v.forEach((x, i) => b.writeUInt16LE(x, i * 2)); return b; }
function longs(...v: number[]): Buffer { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeUInt32LE(x, i * 4)); return b; }
function doubles(...v: number[]): Buffer { const b = Buffer.alloc(v.length * 8); v.forEach((x, i) => b.writeDoubleLE(x, i * 8)); return b; }

function encodeTile(image: TestImage, tx: number, ty: number, predictor: number): Buffer {
  const s = image.tileSize;
  const raw = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const gx = tx * s + x;
      const gy = ty * s + y;
      const v = gx < image.width && gy < image.height ? image.values[gy * image.width + gx] : -9999;
      raw.writeFloatLE(v, (y * s + x) * 4);
    }
  }
  if (predictor === 3) {
    // floating point predictor: bytes MSB-first in planes per row, then byte-wise delta
    const out = Buffer.alloc(raw.length);
    const rowBytes = s * 4;
    for (let y = 0; y < s; y++) {
      const row = out.subarray(y * rowBytes, (y + 1) * rowBytes);
      for (let i = 0; i < s; i++) {
        for (let b = 0; b < 4; b++) row[b * s + i] = raw[y * rowBytes + i * 4 + (3 - b)];
      }
      for (let i = rowBytes - 1; i > 0; i--) row[i] = (row[i] - row[i - 1]) & 255;
    }
    return zlib.deflateSync(out);
  }
  return zlib.deflateSync(raw);
}

export function writeCog(images: TestImage[], geo: { originX: number; originY: number; res: number; nodata?: number }, predictor = 1): Buffer {
  const tiles = images.map(img => {
    const across = Math.ceil(img.width / img.tileSize);
    const down = Math.ceil(img.height / img.tileSize);
    const blocks: Buffer[] = [];
    for (let ty = 0; ty < down; ty++) for (let tx = 0; tx < across; tx++) blocks.push(encodeTile(img, tx, ty, predictor));
    return blocks;
  });

  const ifds = images.map((img, i) => {
    const n = tiles[i].length;
    const entries: Entry[] = [
      { tag: 254, type: LONG, count: 1, data: longs(i === 0 ? 0 : 1) },
      { tag: 256, type: LONG, count: 1, data: longs(img.width) },
      { tag: 257, type: LONG, count: 1, data: longs(img.height) },
      { tag: 258, type: SHORT, count: 1, data: shorts(32) },
      { tag: 259, type: SHORT, count: 1, data: shorts(8) },
      { tag: 262, type: SHORT, count: 1, data: shorts(1) },
      { tag: 277, type: SHORT, count: 1, data: shorts(1) },
      { tag: 317, type: SHORT, count: 1, data: shorts(predictor) },
      { tag: 322, type: SHORT, count: 1, data: shorts(img.tileSize) },
      { tag: 323, type: SHORT, count: 1, data: shorts(img.tileSize) },
      { tag: 324, type: LONG, count: n, data: longs(...new Array(n).fill(0)) },
      { tag: 325, type: LONG, count: n, data: longs(...tiles[i].map(t => t.length)) },
      { tag: 339, type: SHORT, count: 1, data: shorts(3) },
    ];
    if (i === 0) {
      entries.push(
        { tag: 33550, type: DOUBLE, count: 3, data: doubles(geo.res, geo.res, 0) },
        { tag: 33922, type: DOUBLE, count: 6, data: doubles(0, 0, 0, geo.originX, geo.originY, 0) },
      );
      if (geo.nodata !== undefined) {
        const text = Buffer.from(`${geo.nodata}\0`, 'ascii');
        entries.push({ tag: 42113, type: ASCII, count: text.length, data: text });
      }
    }
    return entries;
  });

  // Layout: header | IFDs (with their out-of-line values) | tile data
  const ifdSize = (entries: Entry[]): number => 2 + entries.length * 12 + 4
    + entries.reduce((sum, e) => sum + (e.data.length > 4 ? e.data.length + (e.data.length % 2) : 0), 0);
  const ifdOffsets: number[] = [];
  let offset = 8;
  for (const entries of ifds) { ifdOffsets.push(offset); offset += ifdSize(entries); }
  // tile offsets
  ifds.forEach((entries, i) => {
    const offsets: number[] = [];
    for (const block of tiles[i]) { offsets.push(offset); offset += block.length; }
    entries.find(e => e.tag === 324)!.data = longs(...offsets);
  });

  const out = Buffer.alloc(offset);
  out.write('II', 0, 'ascii');
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(ifdOffsets[0], 4);
  ifds.forEach((entries, i) => {
    let p = ifdOffsets[i];
    out.writeUInt16LE(entries.length, p);
    let extra = p + 2 + entries.length * 12 + 4;
    p += 2;
    for (const e of entries) {
      out.writeUInt16LE(e.tag, p);
      out.writeUInt16LE(e.type, p + 2);
      out.writeUInt32LE(e.count, p + 4);
      if (e.data.length <= 4) e.data.copy(out, p + 8);
      else { out.writeUInt32LE(extra, p + 8); e.data.copy(out, extra); extra += e.data.length + (e.data.length % 2); }
      p += 12;
    }
    out.writeUInt32LE(i + 1 < ifds.length ? ifdOffsets[i + 1] : 0, p);
  });
  let dataOffset = ifdOffsets[ifdOffsets.length - 1] + ifdSize(ifds[ifds.length - 1]);
  for (const blocks of tiles) for (const block of blocks) { block.copy(out, dataOffset); dataOffset += block.length; }
  return out;
}
