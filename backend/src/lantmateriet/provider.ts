/**
 * Lantmäteriet Markhöjdmodell (1 m terrain model) rendered into Web
 * Mercator elevation tiles.
 *
 * The model is published as 10 × 10 km Cloud-Optimized GeoTIFFs in
 * SWEREF 99 TM, found through Lantmäteriet's public STAC API. Downloading
 * the files needs a Geotorget account with "Markhöjdmodell Nedladdning"
 * ordered (free; CC BY 4.0). Credentials stay on the backend.
 *
 * For each tile, every pixel centre is projected to SWEREF 99 TM and the
 * height sampled (bilinear) from the coarsest image level of the file
 * that is still at least as fine as the tile's pixels. Pixels with no data
 * (outside Sweden, gaps) are NaN; the caller fills them from another source.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { CogInfo, CogSource, openCOG, pickImage, readWindow } from './cog.js';
import { toSweref99tm } from './sweref.js';

export const LANTMATERIET_STAC_URL = 'https://api.lantmateriet.se/stac-hojd/v1/search';
export const LANTMATERIET_COLLECTION = 'dtm-cog';
export const TILE_SIZE = 256;
const MAX_CONCURRENT_REQUESTS = 2;
// STAC searches are made per z10 area (a route's tiles share a few searches)
const STAC_AREA_ZOOM = 10;
const STAC_RETRIES = 4;

interface StacFile {
  href: string;
  /** WGS84 footprint [minLng, minLat, maxLng, maxLat], when the catalogue gives one */
  bbox: number[] | null;
}

export interface LantmaterietOptions {
  user: string;
  pass: string;
  cacheDir: string;
  fetchImpl?: typeof fetch;
  stacUrl?: string;
}

/** Latitude/longitude of the centre of pixel (i, j) in tile z/x/y. */
export function pixelLatLng(z: number, x: number, y: number, i: number, j: number): { lat: number; lng: number } {
  const n = 2 ** z;
  const lng = ((x + (i + 0.5) / TILE_SIZE) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (j + 0.5) / TILE_SIZE)) / n))) * 180) / Math.PI;
  return { lat, lng };
}

/** WGS84 bounds of a tile: [minLng, minLat, maxLng, maxLat]. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lat = (row: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}

/** Wrap fetch so at most `limit` requests run at once. */
function limitFetch(doFetch: typeof fetch, limit: number): typeof fetch {
  let active = 0;
  const queue: Array<() => void> = [];
  return (async (...args: Parameters<typeof fetch>) => {
    if (active >= limit) await new Promise<void>(resolve => queue.push(resolve));
    active += 1;
    try {
      return await doFetch(...args);
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  }) as typeof fetch;
}

/** Bilinear sample of a window, ignoring NaN neighbours; NaN if none are valid. */
function sampleWindow(win: Float32Array, width: number, height: number, fc: number, fr: number): number {
  const c0 = Math.floor(fc);
  const r0 = Math.floor(fr);
  const tx = fc - c0;
  const tz = fr - r0;
  let sum = 0;
  let weight = 0;
  for (const [dc, dr, w] of [[0, 0, (1 - tx) * (1 - tz)], [1, 0, tx * (1 - tz)], [0, 1, (1 - tx) * tz], [1, 1, tx * tz]]) {
    const c = c0 + dc;
    const r = r0 + dr;
    if (c < 0 || r < 0 || c >= width || r >= height) continue;
    const v = win[r * width + c];
    if (Number.isNaN(v)) continue;
    sum += v * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : NaN;
}

export function createLantmaterietRenderer(options: LantmaterietOptions) {
  const doFetch = limitFetch(options.fetchImpl ?? fetch, MAX_CONCURRENT_REQUESTS);
  const source: CogSource = {
    headers: { Authorization: 'Basic ' + Buffer.from(`${options.user}:${options.pass}`).toString('base64') },
    cacheDir: path.join(options.cacheDir, 'lantmateriet'),
    fetchImpl: doFetch,
    concurrency: MAX_CONCURRENT_REQUESTS,
  };
  const cogs = new Map<string, Promise<CogInfo>>();

  async function openCached(url: string): Promise<CogInfo> {
    let pending = cogs.get(url);
    if (!pending) {
      const infoFile = path.join(source.cacheDir as string, 'info', `${path.basename(new URL(url).pathname, '.tif')}.json`);
      pending = fs.readFile(infoFile, 'utf8')
        .then(text => JSON.parse(text) as CogInfo)
        .catch(async () => {
          const info = await openCOG(url, source);
          await fs.mkdir(path.dirname(infoFile), { recursive: true });
          await fs.writeFile(infoFile, JSON.stringify(info));
          return info;
        });
      pending.catch(() => cogs.delete(url)); // retry after failures
      cogs.set(url, pending);
    }
    return pending;
  }

  /** STAC search (public, no credentials), retrying politely when rate limited. */
  async function searchFiles(bounds: [number, number, number, number]): Promise<StacFile[]> {
    const url = `${options.stacUrl ?? LANTMATERIET_STAC_URL}?collections=${LANTMATERIET_COLLECTION}&bbox=${bounds.join(',')}&limit=100`;
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(url, { headers: { Accept: 'application/geo+json' } });
      if (res.ok) {
        const body = await res.json() as { features?: Array<{ bbox?: number[]; assets?: { data?: { href?: string } } }> };
        return (body.features ?? [])
          .filter(f => f.assets?.data?.href)
          .map(f => ({ href: f.assets?.data?.href as string, bbox: f.bbox?.length === 4 ? f.bbox : null }));
      }
      if (res.status !== 429 || attempt >= STAC_RETRIES) throw new Error(`STAC search failed: HTTP ${res.status}`);
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 || 1000 * 2 ** attempt));
    }
  }

  // One search per z10 area (~20–40 km across), kept in memory and on disk, so
  // a route's tiles share a handful of searches instead of one each
  const areaFiles = new Map<string, Promise<StacFile[]>>();

  function filesForArea(ax: number, ay: number): Promise<StacFile[]> {
    const key = `${STAC_AREA_ZOOM}_${ax}_${ay}`;
    let pending = areaFiles.get(key);
    if (!pending) {
      const file = path.join(source.cacheDir as string, 'stac', `${key}.json`);
      pending = fs.readFile(file, 'utf8')
        .then(text => JSON.parse(text) as StacFile[])
        .catch(async () => {
          const found = await searchFiles(tileBounds(STAC_AREA_ZOOM, ax, ay));
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, JSON.stringify(found));
          return found;
        });
      pending.catch(() => areaFiles.delete(key)); // retry after failures
      areaFiles.set(key, pending);
    }
    return pending;
  }

  /** Data file URLs whose footprint overlaps the tile. */
  async function filesFor(z: number, x: number, y: number): Promise<string[]> {
    const [minLng, minLat, maxLng, maxLat] = tileBounds(z, x, y);
    if (z < STAC_AREA_ZOOM) return (await searchFiles([minLng, minLat, maxLng, maxLat])).map(f => f.href);
    const shift = z - STAC_AREA_ZOOM;
    const area = await filesForArea(x >> shift, y >> shift);
    return area
      .filter(f => !f.bbox || (f.bbox[0] <= maxLng && f.bbox[2] >= minLng && f.bbox[1] <= maxLat && f.bbox[3] >= minLat))
      .map(f => f.href);
  }

  /**
   * Heights (m) for tile z/x/y, TILE_SIZE² values row by row; NaN where
   * Lantmäteriet has no data. Returns null when no file covers the tile.
   */
  return async function renderTile(z: number, x: number, y: number): Promise<Float32Array | null> {
    const files = await filesFor(z, x, y);
    if (files.length === 0) return null;

    const count = TILE_SIZE * TILE_SIZE;
    const easting = new Float64Array(count);
    const northing = new Float64Array(count);
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    for (let j = 0; j < TILE_SIZE; j++) {
      for (let i = 0; i < TILE_SIZE; i++) {
        const { lat, lng } = pixelLatLng(z, x, y, i, j);
        const [e, n] = toSweref99tm(lat, lng);
        const k = j * TILE_SIZE + i;
        easting[k] = e;
        northing[k] = n;
        minE = Math.min(minE, e); maxE = Math.max(maxE, e);
        minN = Math.min(minN, n); maxN = Math.max(maxN, n);
      }
    }
    const pixelSize = (maxE - minE) / TILE_SIZE;
    const heights = new Float32Array(count).fill(NaN);

    for (const url of files) {
      const info = await openCached(url);
      const level = pickImage(info, pixelSize);
      const image = info.images[level];
      const c0 = Math.max(0, Math.floor((minE - info.originX) / image.resX) - 1);
      const c1 = Math.min(image.width, Math.ceil((maxE - info.originX) / image.resX) + 1);
      const r0 = Math.max(0, Math.floor((info.originY - maxN) / image.resY) - 1);
      const r1 = Math.min(image.height, Math.ceil((info.originY - minN) / image.resY) + 1);
      if (c1 <= c0 || r1 <= r0) continue;

      const win = await readWindow(info, level, c0, r0, c1, r1, source);
      const width = c1 - c0;
      const height = r1 - r0;
      for (let k = 0; k < count; k++) {
        if (!Number.isNaN(heights[k])) continue;
        // pixel centres: column c covers [originX + c·res, originX + (c+1)·res)
        const fc = (easting[k] - info.originX) / image.resX - 0.5 - c0;
        const fr = (info.originY - northing[k]) / image.resY - 0.5 - r0;
        if (fc < -0.5 || fr < -0.5 || fc > width - 0.5 || fr > height - 0.5) continue;
        heights[k] = sampleWindow(win, width, height, fc, fr);
      }
    }
    return heights;
  };
}
