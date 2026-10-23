/**
 * Minimal PNG encoder for 8-bit RGB images (filter 0, zlib-compressed).
 * Used to emit terrarium-encoded elevation tiles without a dependency.
 */

import * as zlib from 'zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Encode width×height RGB pixels (3 bytes each, row-major) as a PNG file. */
export function encodePngRgb(width: number, height: number, rgb: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;   // bit depth
  header[9] = 2;   // colour type: RGB
  header[10] = 0;  // compression
  header[11] = 0;  // filter
  header[12] = 0;  // no interlace

  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Terrarium encoding: (elevation + 32768 m) in 1/256 m steps, split into R, G, B bytes. */
export function terrariumRgb(heights: Float32Array): Uint8Array {
  const rgb = new Uint8Array(heights.length * 3);
  for (let i = 0; i < heights.length; i++) {
    const q = Math.max(0, Math.min(0xFFFFFF, Math.round((heights[i] + 32768) * 256)));
    rgb[i * 3] = q >>> 16;
    rgb[i * 3 + 1] = (q >>> 8) & 0xFF;
    rgb[i * 3 + 2] = q & 0xFF;
  }
  return rgb;
}

/**
 * Decode an 8-bit RGB or RGBA, non-interlaced PNG into RGB pixels
 * (enough for terrarium tiles).
 */
export function decodePngRgb(png: Buffer): { width: number; height: number; rgb: Uint8Array } {
  if (png.readUInt32BE(0) !== 0x89504E47) throw new Error('Not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 3;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0 || (data[9] !== 2 && data[9] !== 6)) throw new Error('Unsupported PNG format');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? pixels[y * stride + i - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + i] = (line[i] + predicted) & 0xFF;
    }
  }

  if (channels === 3) return { width, height, rgb: pixels };
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(pixels.subarray(i * 4, i * 4 + 3), i * 3);
  return { width, height, rgb };
}

/** Terrarium RGB → elevation in metres. */
export function terrariumHeights(rgb: Uint8Array): Float32Array {
  const heights = new Float32Array(rgb.length / 3);
  for (let i = 0; i < heights.length; i++) {
    heights[i] = rgb[i * 3] * 256 + rgb[i * 3 + 1] + rgb[i * 3 + 2] / 256 - 32768;
  }
  return heights;
}
