/**
 * Cloud-Optimized GeoTIFF reader that fetches only what it needs with HTTP
 * range requests: the header and image directories, then the individual
 * compressed blocks covering a requested window.
 *
 * Written from the TIFF 6.0 specification, the BigTIFF extension, Adobe's
 * TIFF Technical Note 3 (floating-point predictor) and the GeoTIFF tags.
 * Every image in the file is read — the full-resolution image and its
 * reduced-resolution overviews — so a coarse map tile can be made from an
 * overview instead of the full grid.
 *
 * Supported: tiled single-band images of 8/16/32/64-bit integers or floats,
 * no compression or deflate, predictor none / horizontal / floating point,
 * little- or big-endian, classic TIFF and BigTIFF.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';

// TIFF tags used here
const TAG = {
  NEW_SUBFILE_TYPE: 254,
  IMAGE_WIDTH: 256,
  IMAGE_LENGTH: 257,
  BITS_PER_SAMPLE: 258,
  COMPRESSION: 259,
  SAMPLES_PER_PIXEL: 277,
  PREDICTOR: 317,
  TILE_WIDTH: 322,
  TILE_LENGTH: 323,
  TILE_OFFSETS: 324,
  TILE_BYTE_COUNTS: 325,
  SAMPLE_FORMAT: 339,
  MODEL_PIXEL_SCALE: 33550,
  MODEL_TIEPOINT: 33922,
  GDAL_NODATA: 42113,
} as const;

// Field types: byte size of one value
const FIELD_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8,
};

const COMPRESSION_NONE = 1;
const COMPRESSION_DEFLATE = [8, 32946];
const PREDICTOR_HORIZONTAL = 2;
const PREDICTOR_FLOATING_POINT = 3;
const SAMPLE_FORMAT_INT = 2;
const SAMPLE_FORMAT_FLOAT = 3;

const FIRST_READ_BYTES = 64 * 1024;   // header + directories of a typical COG
const MAX_IMAGES = 32;

export interface CogImage {
  width: number;
  height: number;
  tileW: number;
  tileH: number;
  bits: number;
  sampleFormat: number;
  compression: number;
  predictor: number;
  offsets: number[];
  counts: number[];
  /** ground size of one pixel in this image (CRS units) */
  resX: number;
  resY: number;
}

export interface CogInfo {
  url: string;
  littleEndian: boolean;
  /** top-left corner of the full-resolution image (CRS units) */
  originX: number;
  originY: number;
  nodata: number | null;
  /** full resolution first, then overviews from fine to coarse */
  images: CogImage[];
}

export interface CogSource {
  headers: Record<string, string>;
  cacheDir: string | null;
  fetchImpl?: typeof fetch;
  /** maximum simultaneous block requests */
  concurrency?: number;
}

export class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch bytes [start, start + length) of a URL. Bodies of the wrong length
 * (a transfer cut short) are retried, as are rate limits and server errors;
 * 401 and 404 fail at once. `minLength` accepts a shorter body (reading past
 * the end of a small file).
 */
async function fetchBytes(
  source: CogSource, url: string, start: number, length: number, attempts: number, minLength = length,
): Promise<Buffer> {
  const doFetch = source.fetchImpl ?? fetch;
  let status = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await doFetch(url, { headers: { ...source.headers, Range: `bytes=${start}-${start + length - 1}` } });
    status = response.status;
    if (status === 401 || status === 404) break;

    if (status === 206 || status === 200) {
      const body = await response.arrayBuffer().then(b => Buffer.from(b), () => null);
      // 200 means the server ignored the range and sent the whole file
      const part = body && status === 200 ? body.subarray(start, start + length) : body;
      if (part && part.length >= minLength && part.length <= length) return part;
    }

    if (attempt < attempts) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 500 * 2 ** attempt));
    }
  }
  throw new HttpError(`HTTP ${status} for ${url}`, status);
}

/** Reads integers and floats from a buffer in the file's byte order. */
function binaryReader(littleEndian: boolean) {
  return {
    u8: (b: Buffer, at: number): number => b.readUInt8(at),
    u16: (b: Buffer, at: number): number => (littleEndian ? b.readUInt16LE(at) : b.readUInt16BE(at)),
    u32: (b: Buffer, at: number): number => (littleEndian ? b.readUInt32LE(at) : b.readUInt32BE(at)),
    u64: (b: Buffer, at: number): number => Number(littleEndian ? b.readBigUInt64LE(at) : b.readBigUInt64BE(at)),
    f32: (b: Buffer, at: number): number => (littleEndian ? b.readFloatLE(at) : b.readFloatBE(at)),
    f64: (b: Buffer, at: number): number => (littleEndian ? b.readDoubleLE(at) : b.readDoubleBE(at)),
  };
}

type Reader = ReturnType<typeof binaryReader>;
type FieldValues = number[] | string;

/** Decode the values of one directory entry. */
function decodeField(r: Reader, type: number, count: number, bytes: Buffer): FieldValues {
  if (type === 2) return bytes.subarray(0, count).toString('latin1').replace(/\0.*$/s, '');
  const size = FIELD_SIZE[type] ?? 1;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = i * size;
    switch (type) {
      case 3: values.push(r.u16(bytes, at)); break;
      case 4: case 13: values.push(r.u32(bytes, at)); break;
      case 16: case 18: values.push(r.u64(bytes, at)); break;
      case 11: values.push(r.f32(bytes, at)); break;
      case 12: values.push(r.f64(bytes, at)); break;
      case 5: values.push(r.u32(bytes, at) / r.u32(bytes, at + 4)); break;
      default: values.push(r.u8(bytes, at));
    }
  }
  return values;
}

/** Read the header and every image directory of a COG. */
export async function openCOG(url: string, source: CogSource): Promise<CogInfo> {
  // The header and directories usually sit in the first 64 KB (a small file may be shorter)
  const first = await fetchBytes(source, url, 0, FIRST_READ_BYTES, 3, 16);
  const bytesAt = async (offset: number, length: number): Promise<Buffer> => (
    offset + length <= first.length ? first.subarray(offset, offset + length) : fetchBytes(source, url, offset, length, 3)
  );

  const order = first.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') throw new Error('Not a TIFF file');
  const littleEndian = order === 'II';
  const r = binaryReader(littleEndian);
  const version = r.u16(first, 2);
  if (version !== 42 && version !== 43) throw new Error(`Unsupported TIFF version ${version}`);
  const big = version === 43;

  // Directory layout differs between classic TIFF and BigTIFF
  const countSize = big ? 8 : 2;
  const entrySize = big ? 20 : 12;
  const pointerSize = big ? 8 : 4;
  const readCount = (b: Buffer, at: number): number => (big ? r.u64(b, at) : r.u16(b, at));
  const readPointer = (b: Buffer, at: number): number => (big ? r.u64(b, at) : r.u32(b, at));

  const directories: Array<Map<number, FieldValues>> = [];
  let next = readPointer(first, big ? 8 : 4);
  while (next !== 0 && directories.length < MAX_IMAGES) {
    const entryCount = readCount(await bytesAt(next, countSize), 0);
    const table = await bytesAt(next + countSize, entryCount * entrySize + pointerSize);
    const fields = new Map<number, FieldValues>();
    for (let e = 0; e < entryCount; e++) {
      const at = e * entrySize;
      const tag = r.u16(table, at);
      const type = r.u16(table, at + 2);
      const count = big ? r.u64(table, at + 4) : r.u32(table, at + 4);
      const length = (FIELD_SIZE[type] ?? 1) * count;
      const valueAt = at + 4 + (big ? 8 : 4);
      const bytes = length <= pointerSize
        ? table.subarray(valueAt, valueAt + length)
        : await bytesAt(readPointer(table, valueAt), length);
      fields.set(tag, decodeField(r, type, count, bytes));
    }
    directories.push(fields);
    next = readPointer(table, entryCount * entrySize);
  }
  if (directories.length === 0) throw new Error('TIFF has no images');

  const number = (fields: Map<number, FieldValues>, tag: number, fallback?: number): number => {
    const v = fields.get(tag);
    return Array.isArray(v) && v.length ? v[0] : (fallback as number);
  };
  const numbers = (fields: Map<number, FieldValues>, tag: number): number[] => {
    const v = fields.get(tag);
    return Array.isArray(v) ? v : [];
  };

  const main = directories[0];
  const [scaleX, scaleY] = numbers(main, TAG.MODEL_PIXEL_SCALE);
  const tie = numbers(main, TAG.MODEL_TIEPOINT);
  if (!scaleX || !scaleY || tie.length < 6) throw new Error('GeoTIFF has no pixel scale / tie point');
  const fullWidth = number(main, TAG.IMAGE_WIDTH);
  const fullHeight = number(main, TAG.IMAGE_LENGTH);

  const images: CogImage[] = [];
  directories.forEach((fields, index) => {
    const subfile = number(fields, TAG.NEW_SUBFILE_TYPE, 0);
    const isOverview = (subfile & 1) === 1;
    const isMask = (subfile & 4) === 4;
    if (isMask || (index > 0 && !isOverview)) return;

    const width = number(fields, TAG.IMAGE_WIDTH);
    const height = number(fields, TAG.IMAGE_LENGTH);
    const tileW = number(fields, TAG.TILE_WIDTH, 0);
    const compression = number(fields, TAG.COMPRESSION, COMPRESSION_NONE);
    if (!tileW) throw new Error('Only tiled TIFFs are supported');
    if (number(fields, TAG.SAMPLES_PER_PIXEL, 1) !== 1) throw new Error('Only single-band TIFFs are supported');
    if (compression !== COMPRESSION_NONE && !COMPRESSION_DEFLATE.includes(compression)) {
      throw new Error(`Unsupported compression ${compression}`);
    }

    images.push({
      width,
      height,
      tileW,
      tileH: number(fields, TAG.TILE_LENGTH, tileW),
      bits: number(fields, TAG.BITS_PER_SAMPLE, 8),
      sampleFormat: number(fields, TAG.SAMPLE_FORMAT, 1),
      compression,
      predictor: number(fields, TAG.PREDICTOR, 1),
      offsets: numbers(fields, TAG.TILE_OFFSETS),
      counts: numbers(fields, TAG.TILE_BYTE_COUNTS),
      // overviews cover the same extent with fewer, larger pixels
      resX: scaleX * (fullWidth / width),
      resY: scaleY * (fullHeight / height),
    });
  });

  // Tie point: raster (i, j) maps to model (x, y); move it to the raster's corner
  const [i0, j0, , x0, y0] = tie;
  const nodata = main.get(TAG.GDAL_NODATA);
  return {
    url,
    littleEndian,
    originX: x0 - i0 * scaleX,
    originY: y0 + j0 * scaleY,
    nodata: typeof nodata === 'string' && nodata.trim() !== '' ? Number(nodata) : null,
    images,
  };
}

/** Index of the coarsest image whose pixels are no larger than `maxPixelSize` (CRS units). */
export function pickImage(info: CogInfo, maxPixelSize: number): number {
  let chosen = 0;
  for (let i = 1; i < info.images.length; i++) {
    const res = info.images[i].resX;
    if (res <= maxPixelSize && res > info.images[chosen].resX) chosen = i;
  }
  return chosen;
}

/** Decompress and decode one block into sample values (row-major). */
export function decodeBlock(image: CogImage, littleEndian: boolean, compressed: Buffer): Float32Array {
  const data = image.compression === COMPRESSION_NONE ? compressed : zlib.inflateSync(compressed);
  const width = image.tileW;
  const height = image.tileH;
  const bytesPerSample = image.bits / 8;
  const samples = new Float32Array(width * height);

  if (image.predictor === PREDICTOR_FLOATING_POINT) {
    // Each row holds the samples' bytes split into planes (most significant
    // byte of every sample first), differenced byte by byte along the row.
    const rowBytes = width * bytesPerSample;
    const value = new DataView(new ArrayBuffer(bytesPerSample));
    for (let y = 0; y < height; y++) {
      const row = Uint8Array.from(data.subarray(y * rowBytes, (y + 1) * rowBytes));
      for (let i = 1; i < rowBytes; i++) row[i] = (row[i] + row[i - 1]) & 0xFF;
      for (let x = 0; x < width; x++) {
        for (let plane = 0; plane < bytesPerSample; plane++) value.setUint8(plane, row[plane * width + x]);
        samples[y * width + x] = bytesPerSample === 4 ? value.getFloat32(0, false) : value.getFloat64(0, false);
      }
    }
    return samples;
  }

  const r = binaryReader(littleEndian);
  const isFloat = image.sampleFormat === SAMPLE_FORMAT_FLOAT;
  const isSigned = image.sampleFormat === SAMPLE_FORMAT_INT;
  for (let i = 0; i < samples.length; i++) {
    const at = i * bytesPerSample;
    if (isFloat) samples[i] = bytesPerSample === 8 ? r.f64(data, at) : r.f32(data, at);
    else if (bytesPerSample === 1) samples[i] = isSigned ? data.readInt8(at) : data[at];
    else if (bytesPerSample === 2) samples[i] = isSigned ? (littleEndian ? data.readInt16LE(at) : data.readInt16BE(at)) : r.u16(data, at);
    else samples[i] = isSigned ? (littleEndian ? data.readInt32LE(at) : data.readInt32BE(at)) : r.u32(data, at);
  }

  if (image.predictor === PREDICTOR_HORIZONTAL) {
    if (isFloat) throw new Error('Horizontal predictor on floating-point data is not supported');
    for (let y = 0; y < height; y++) {
      for (let x = 1; x < width; x++) samples[y * width + x] += samples[y * width + x - 1];
    }
  }
  return samples;
}

/**
 * Read the pixel window [c0, c1) × [r0, r1) of one image as a row-major
 * array. Pixels outside the image, in empty blocks or equal to nodata are
 * NaN. Blocks are cached on disk (when cacheDir is set) once they decode,
 * so each block is downloaded only once; a cached block that no longer
 * decodes is downloaded again.
 */
export async function readWindow(
  info: CogInfo, imageIndex: number, c0: number, r0: number, c1: number, r1: number, source: CogSource,
): Promise<Float32Array> {
  const image = info.images[imageIndex];
  const outWidth = c1 - c0;
  const outHeight = r1 - r0;
  const out = new Float32Array(outWidth * outHeight).fill(NaN);
  const blocksAcross = Math.ceil(image.width / image.tileW);
  const blocksDown = Math.ceil(image.height / image.tileH);
  const fileKey = path.basename(new URL(info.url).pathname, '.tif');

  const pending: Array<{ bx: number; by: number }> = [];
  const firstBy = Math.max(0, Math.floor(r0 / image.tileH));
  const lastBy = Math.min(blocksDown - 1, Math.floor((r1 - 1) / image.tileH));
  const firstBx = Math.max(0, Math.floor(c0 / image.tileW));
  const lastBx = Math.min(blocksAcross - 1, Math.floor((c1 - 1) / image.tileW));
  for (let by = firstBy; by <= lastBy; by++) {
    for (let bx = firstBx; bx <= lastBx; bx++) pending.push({ bx, by });
  }

  const loadBlock = async (bx: number, by: number): Promise<Float32Array | null> => {
    const index = by * blocksAcross + bx;
    const length = image.counts[index];
    if (!length) return null; // empty block: all nodata

    const cacheFile = source.cacheDir
      ? path.join(source.cacheDir, 'blocks', fileKey, String(imageIndex), `${bx}_${by}.bin`)
      : null;
    if (cacheFile) {
      const cached = await fs.readFile(cacheFile).catch(() => null);
      if (cached) {
        try {
          return decodeBlock(image, info.littleEndian, cached);
        } catch {
          // damaged cache entry: fall through and download it again
        }
      }
    }

    const compressed = await fetchBytes(source, info.url, image.offsets[index], length, 6);
    const decoded = decodeBlock(image, info.littleEndian, compressed);
    if (cacheFile) {
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, compressed);
    }
    return decoded;
  };

  const copyBlock = (bx: number, by: number, block: Float32Array): void => {
    for (let y = 0; y < image.tileH; y++) {
      const outRow = by * image.tileH + y - r0;
      if (outRow < 0 || outRow >= outHeight) continue;
      for (let x = 0; x < image.tileW; x++) {
        const outCol = bx * image.tileW + x - c0;
        if (outCol < 0 || outCol >= outWidth) continue;
        const v = block[y * image.tileW + x];
        out[outRow * outWidth + outCol] = info.nodata !== null && v === info.nodata ? NaN : v;
      }
    }
  };

  // A few blocks at a time; the first failure stops the rest
  let failure: unknown = null;
  const worker = async (): Promise<void> => {
    for (let job = pending.shift(); job && failure === null; job = pending.shift()) {
      try {
        const block = await loadBlock(job.bx, job.by);
        if (block) copyBlock(job.bx, job.by, block);
      } catch (err) {
        failure = err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, source.concurrency ?? 2) }, worker));
  if (failure !== null) throw failure;
  return out;
}
