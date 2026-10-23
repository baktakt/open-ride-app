/**
 * Terrain tile proxy.
 *
 * The browser never contacts map-data providers directly (privacy): it asks
 * this backend for elevation tiles, and the backend fetches them from the
 * provider and caches them on disk. Upstream providers only ever see the
 * backend, never the rider.
 *
 * Every provider serves tiles in the same encoding — 256×256 PNG in the
 * "terrarium" format (elevation = R·256 + G + B/256 − 32768 metres) on the
 * standard Web Mercator z/x/y grid — so the frontend works with any of them.
 * A future Lantmäteriet provider (1 m Markhöjdmodell, needs Geotorget
 * credentials) can render its data into this format server-side.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface TerrainProvider {
  id: string;
  name: string;
  maxZoom: number;
  attribution: string;
  tileUrl(z: number, x: number, y: number): string;
}

const PROVIDERS: Record<string, TerrainProvider> = {
  // AWS Open Data "Terrain Tiles" (formerly Mapzen) — global, no key needed
  terrarium: {
    id: 'terrarium',
    name: 'AWS Terrain Tiles',
    maxZoom: 14,
    attribution: 'Terrain Tiles: Mapzen / AWS Open Data — sources include SRTM, GMTED2010, ETOPO1, EU-DEM, ArcticDEM and national elevation models',
    tileUrl: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  },
};

export const DEFAULT_PROVIDER = 'terrarium';

const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_UPSTREAM = 6;
const USER_AGENT = 'OpenRide/0.1 (+https://github.com/baktakt/open-ride-app)';

export type TileResult =
  | { status: 'ok'; body: Buffer; cached: boolean }
  | { status: 'invalid'; message: string }
  | { status: 'not_found' }
  | { status: 'upstream_error'; message: string };

export function listProviders(): Array<Omit<TerrainProvider, 'tileUrl'>> {
  return Object.values(PROVIDERS).map(({ id, name, maxZoom, attribution }) => ({ id, name, maxZoom, attribution }));
}

/**
 * Validate tile coordinates. Returns an error message or null.
 */
export function validateTile(provider: TerrainProvider | undefined, z: number, x: number, y: number): string | null {
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

// De-duplicate concurrent requests for the same tile
const inFlight = new Map<string, Promise<TileResult>>();

export function createTerrainTileService(cacheDir: string) {
  async function readCache(file: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(file);
    } catch {
      return null;
    }
  }

  async function fetchUpstream(provider: TerrainProvider, z: number, x: number, y: number, file: string): Promise<TileResult> {
    return withUpstreamSlot(async () => {
      let response: Response;
      try {
        response = await fetch(provider.tileUrl(z, x, y), {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch (err) {
        return { status: 'upstream_error', message: (err as Error).message };
      }
      if (response.status === 404) return { status: 'not_found' };
      if (!response.ok) return { status: 'upstream_error', message: `Upstream responded ${response.status}` };

      const body = Buffer.from(await response.arrayBuffer());
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, body);
      } catch (err) {
        console.warn(`Terrain cache write failed (${file}):`, (err as Error).message);
      }
      return { status: 'ok', body, cached: false };
    });
  }

  return {
    async getTile(providerId: string, z: number, x: number, y: number): Promise<TileResult> {
      const provider = PROVIDERS[providerId];
      const invalid = validateTile(provider, z, x, y);
      if (invalid) return { status: 'invalid', message: invalid };

      const file = path.join(cacheDir, provider.id, String(z), String(x), `${y}.png`);
      const cachedBody = await readCache(file);
      if (cachedBody) return { status: 'ok', body: cachedBody, cached: true };

      const key = `${provider.id}/${z}/${x}/${y}`;
      let pending = inFlight.get(key);
      if (!pending) {
        pending = fetchUpstream(provider, z, x, y, file).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      return pending;
    },
  };
}
