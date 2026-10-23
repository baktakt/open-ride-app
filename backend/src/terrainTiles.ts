/**
 * Terrain tile proxy.
 *
 * The browser never contacts map-data providers directly (privacy): it asks
 * this backend for elevation tiles, and the backend fetches or renders them
 * and caches them on disk. Upstream providers only ever see the backend,
 * never the rider.
 *
 * Every provider serves tiles in the same encoding — 256×256 PNG in the
 * "terrarium" format (elevation = R·256 + G + B/256 − 32768 metres) on the
 * standard Web Mercator z/x/y grid — so the frontend works with any of them.
 *
 * Providers:
 *   terrarium    — AWS Terrain Tiles, fetched as-is (global, no key)
 *   lantmateriet — Lantmäteriet's 1 m Markhöjdmodell, rendered here from its
 *                  Cloud-Optimized GeoTIFFs; only offered when Geotorget
 *                  credentials (LM_USER / LM_PASS) are configured. Areas it
 *                  does not cover are filled from terrarium.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLantmaterietRenderer } from './lantmateriet/provider.js';
import { decodePngRgb, encodePngRgb, terrariumHeights, terrariumRgb } from './lantmateriet/png.js';

interface ProviderInfo {
  id: string;
  name: string;
  maxZoom: number;
  attribution: string;
}

interface RemoteProvider extends ProviderInfo {
  kind: 'remote';
  tileUrl(z: number, x: number, y: number): string;
}

interface RenderedProvider extends ProviderInfo {
  kind: 'rendered';
  /** Heights for the tile (NaN where unknown), or null when not covered at all */
  render(z: number, x: number, y: number): Promise<Float32Array | null>;
  /** provider used to fill pixels this one cannot */
  fallback: string;
}

export type TerrainProvider = RemoteProvider | RenderedProvider;

const TERRARIUM: RemoteProvider = {
  kind: 'remote',
  id: 'terrarium',
  name: 'AWS Terrain Tiles',
  maxZoom: 14,
  attribution: 'Terrain Tiles: Mapzen / AWS Open Data — sources include SRTM, GMTED2010, ETOPO1, EU-DEM, ArcticDEM and national elevation models',
  tileUrl: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
};

export const DEFAULT_PROVIDER = 'terrarium';

const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_UPSTREAM = 6;
const USER_AGENT = 'OpenRide/0.1 (+https://github.com/baktakt/open-ride-app)';

export type TileResult =
  | { status: 'ok'; body: Buffer; cached: boolean; source: string }
  | { status: 'invalid'; message: string }
  | { status: 'not_found' }
  | { status: 'upstream_error'; message: string };

export interface TerrainServiceOptions {
  /** Geotorget account with "Markhöjdmodell Nedladdning" ordered */
  lantmateriet?: { user: string; pass: string } | null;
  fetchImpl?: typeof fetch;
}

/**
 * Validate tile coordinates. Returns an error message or null.
 */
export function validateTile(provider: ProviderInfo | undefined, z: number, x: number, y: number): string | null {
  if (!provider) return 'Unknown terrain provider';
  if (![z, x, y].every(Number.isInteger)) return 'Tile coordinates must be integers';
  if (z < 0 || z > provider.maxZoom) return `Zoom must be between 0 and ${provider.maxZoom}`;
  const max = 2 ** z;
  if (x < 0 || x >= max || y < 0 || y >= max) return 'Tile coordinates out of range';
  return null;
}

// Limit simultaneous upstream requests so one route load cannot flood the provider
let activeUpstream = 0;
const waiting: Array<() => void> = [];

async function withUpstreamSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeUpstream >= MAX_CONCURRENT_UPSTREAM) {
    await new Promise<void>(resolve => waiting.push(resolve));
  }
  activeUpstream += 1;
  try {
    return await fn();
  } finally {
    activeUpstream -= 1;
    waiting.shift()?.();
  }
}

export function createTerrainTileService(cacheDir: string, options: TerrainServiceOptions = {}) {
  const doFetch = options.fetchImpl ?? fetch;
  const providers: Record<string, TerrainProvider> = { terrarium: TERRARIUM };

  if (options.lantmateriet?.user && options.lantmateriet.pass) {
    const render = createLantmaterietRenderer({ ...options.lantmateriet, cacheDir, fetchImpl: options.fetchImpl });
    providers.lantmateriet = {
      kind: 'rendered',
      id: 'lantmateriet',
      name: 'Lantmäteriet Markhöjdmodell (1 m)',
      maxZoom: 14,
      attribution: 'Markhöjdmodell © Lantmäteriet (CC BY 4.0); outside Sweden: Terrain Tiles (Mapzen / AWS Open Data)',
      render,
      fallback: 'terrarium',
    };
  }

  // De-duplicate concurrent requests for the same tile
  const inFlight = new Map<string, Promise<TileResult>>();
  let lastRenderError = 0;

  const cacheFile = (providerId: string, z: number, x: number, y: number): string => (
    path.join(cacheDir, providerId, String(z), String(x), `${y}.png`)
  );

  async function writeCache(file: string, body: Buffer): Promise<void> {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body);
    } catch (err) {
      console.warn(`Terrain cache write failed (${file}):`, (err as Error).message);
    }
  }

  async function fetchRemote(provider: RemoteProvider, z: number, x: number, y: number): Promise<TileResult> {
    return withUpstreamSlot(async () => {
      let response: Response;
      try {
        response = await doFetch(provider.tileUrl(z, x, y), {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch (err) {
        return { status: 'upstream_error', message: (err as Error).message };
      }
      if (response.status === 404) return { status: 'not_found' };
      if (!response.ok) return { status: 'upstream_error', message: `Upstream responded ${response.status}` };

      const body = Buffer.from(await response.arrayBuffer());
      await writeCache(cacheFile(provider.id, z, x, y), body);
      return { status: 'ok', body, cached: false, source: provider.id };
    });
  }

  async function renderTile(provider: RenderedProvider, z: number, x: number, y: number): Promise<TileResult> {
    let heights: Float32Array | null;
    try {
      heights = await provider.render(z, x, y);
    } catch (err) {
      // Keep the 3D view working (bad credentials, rate limiting, outage):
      // serve the fallback tile without caching it under this provider
      if (Date.now() - lastRenderError > 60_000) {
        console.warn(`Terrain provider ${provider.id} failed, using ${provider.fallback}: ${(err as Error).message}`);
        lastRenderError = Date.now();
      }
      return getTile(provider.fallback, z, x, y);
    }

    if (!heights) return getTile(provider.fallback, z, x, y);

    if (heights.some(Number.isNaN)) {
      const fallback = await getTile(provider.fallback, z, x, y);
      if (fallback.status === 'ok') {
        const filler = terrariumHeights(decodePngRgb(fallback.body).rgb);
        for (let i = 0; i < heights.length; i++) {
          if (Number.isNaN(heights[i])) heights[i] = filler[i];
        }
      } else {
        for (let i = 0; i < heights.length; i++) {
          if (Number.isNaN(heights[i])) heights[i] = 0;
        }
      }
    }

    const body = encodePngRgb(256, 256, terrariumRgb(heights));
    await writeCache(cacheFile(provider.id, z, x, y), body);
    return { status: 'ok', body, cached: false, source: provider.id };
  }

  async function getTile(providerId: string, z: number, x: number, y: number): Promise<TileResult> {
    const provider = providers[providerId];
    const invalid = validateTile(provider, z, x, y);
    if (invalid) return { status: 'invalid', message: invalid };

    const cached = await fs.readFile(cacheFile(provider.id, z, x, y)).catch(() => null);
    if (cached) return { status: 'ok', body: cached, cached: true, source: provider.id };

    const key = `${provider.id}/${z}/${x}/${y}`;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = (provider.kind === 'remote' ? fetchRemote(provider, z, x, y) : renderTile(provider, z, x, y))
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending;
  }

  return {
    getTile,
    /** Providers available on this server, best first (no upstream URLs or credentials) */
    listProviders(): ProviderInfo[] {
      return Object.values(providers)
        .sort((a, b) => (a.kind === 'rendered' ? -1 : 0) - (b.kind === 'rendered' ? -1 : 0))
        .map(({ id, name, maxZoom, attribution }) => ({ id, name, maxZoom, attribution }));
    },
  };
}
