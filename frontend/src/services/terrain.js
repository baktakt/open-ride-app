/**
 * Terrain for the 3D route view.
 *
 * Elevation tiles come from the Open Ride backend (/api/terrain/...), which
 * proxies and caches them — the browser never contacts a map-data provider.
 * Tiles are 256×256 "terrarium" PNGs on the Web Mercator z/x/y grid:
 *   elevation (m) = R·256 + G + B/256 − 32768
 *
 * The scene uses a local metric frame centred on the route, in three.js
 * axes: x = east, y = up, z = south (so north is −z).
 *
 * Everything except loadTerrain() is pure and unit tested.
 */

export const TILE_SIZE = 256;
export const TERRAIN_PROVIDER = 'terrarium';
export const MAX_TERRAIN_ZOOM = 13;     // ~10 m per pixel at Swedish latitudes
export const MAX_TERRAIN_TILES = 64;
export const TERRAIN_MARGIN_M = 1500;   // terrain around the route's bounding box
export const MAX_GRID_SAMPLES = 400;    // per side of the height field

const EARTH_RADIUS = 6378137;
const DEG = Math.PI / 180;

// ─── Tiles ───────────────────────────────────────────────────────────────────

/** Fractional Web Mercator tile coordinates of a point. */
export function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latRad = lat * DEG;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Inclusive tile index range covering a lat/lng bounding box. */
export function tileRange(bounds, z) {
  const nw = lngLatToTile(bounds.minLng, bounds.maxLat, z);
  const se = lngLatToTile(bounds.maxLng, bounds.minLat, z);
  return {
    z,
    minX: Math.floor(nw.x),
    maxX: Math.floor(se.x),
    minY: Math.floor(nw.y),
    maxY: Math.floor(se.y),
  };
}

export function tileCount(range) {
  return (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
}

/** Highest zoom (≤ maxZoom) whose tile count for the bounds stays within maxTiles. */
export function chooseZoom(bounds, { maxZoom = MAX_TERRAIN_ZOOM, maxTiles = MAX_TERRAIN_TILES } = {}) {
  for (let z = maxZoom; z > 0; z--) {
    if (tileCount(tileRange(bounds, z)) <= maxTiles) return z;
  }
  return 1;
}

/** Decode terrarium RGBA pixel data (Uint8ClampedArray, 4 bytes/pixel) into metres. */
export function decodeTerrarium(rgba) {
  const heights = new Float32Array(rgba.length / 4);
  for (let i = 0; i < heights.length; i++) {
    const o = i * 4;
    heights[i] = rgba[o] * 256 + rgba[o + 1] + rgba[o + 2] / 256 - 32768;
  }
  return heights;
}

// ─── Local projection ────────────────────────────────────────────────────────

/**
 * Local tangent-plane projection around (lat0, lng0). Accurate to well under
 * a metre over the tens of kilometres of a ride.
 */
export function createLocalProjection(lat0, lng0) {
  const metersPerDegLat = EARTH_RADIUS * DEG;
  const metersPerDegLng = EARTH_RADIUS * DEG * Math.cos(lat0 * DEG);
  return {
    lat0,
    lng0,
    toLocal(lat, lng) {
      return { x: (lng - lng0) * metersPerDegLng, z: -(lat - lat0) * metersPerDegLat };
    },
    toLatLng(x, z) {
      return { lat: lat0 - z / metersPerDegLat, lng: lng0 + x / metersPerDegLng };
    },
  };
}

/** Bounding box of route points, expanded by marginM metres on every side. */
export function routeBounds(points, marginM = TERRAIN_MARGIN_M) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  const midLat = (minLat + maxLat) / 2;
  const dLat = marginM / (EARTH_RADIUS * DEG);
  const dLng = marginM / (EARTH_RADIUS * DEG * Math.cos(midLat * DEG));
  return { minLat: minLat - dLat, maxLat: maxLat + dLat, minLng: minLng - dLng, maxLng: maxLng + dLng };
}

// ─── Height field ────────────────────────────────────────────────────────────

/**
 * Elevation at a lat/lng from decoded tiles (bilinear within the tile mosaic).
 * @param {Map<string, Float32Array>} tiles  key `${x}/${y}` → 256×256 heights
 * @returns {number|null} null when the tile is missing
 */
export function sampleTiles(tiles, z, lat, lng) {
  const t = lngLatToTile(lng, lat, z);
  const px = t.x * TILE_SIZE - 0.5;
  const py = t.y * TILE_SIZE - 0.5;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;

  const at = (gx, gy) => {
    const tile = tiles.get(`${Math.floor(gx / TILE_SIZE)}/${Math.floor(gy / TILE_SIZE)}`);
    if (!tile) return null;
    const lx = ((gx % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    const ly = ((gy % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    return tile[ly * TILE_SIZE + lx];
  };

  const h00 = at(x0, y0), h10 = at(x0 + 1, y0), h01 = at(x0, y0 + 1), h11 = at(x0 + 1, y0 + 1);
  if (h00 === null || h10 === null || h01 === null || h11 === null) {
    return h00 ?? h10 ?? h01 ?? h11;
  }
  return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
}

/**
 * Regular height grid over the bounds in the local frame.
 * Missing elevation (absent tiles) is filled with `fallbackHeight`.
 */
export function buildHeightField({ tiles, z, bounds, projection, fallbackHeight = 0, maxSamples = MAX_GRID_SAMPLES }) {
  const nw = projection.toLocal(bounds.maxLat, bounds.minLng);
  const se = projection.toLocal(bounds.minLat, bounds.maxLng);
  const sizeX = se.x - nw.x;
  const sizeZ = se.z - nw.z;
  const spacing = Math.max(sizeX, sizeZ) / (maxSamples - 1);
  const cols = Math.max(2, Math.ceil(sizeX / spacing) + 1);
  const rows = Math.max(2, Math.ceil(sizeZ / spacing) + 1);
  const heights = new Float32Array(cols * rows);
  let missing = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { lat, lng } = projection.toLatLng(nw.x + c * spacing, nw.z + r * spacing);
      const h = sampleTiles(tiles, z, lat, lng);
      if (h === null || !Number.isFinite(h)) missing += 1;
      heights[r * cols + c] = h === null || !Number.isFinite(h) ? fallbackHeight : h;
    }
  }

  return { originX: nw.x, originZ: nw.z, spacing, cols, rows, heights, missing };
}

/** Bilinear height at local (x, z); clamps to the field's edges. */
export function heightAt(field, x, z) {
  const fx = Math.min(field.cols - 1, Math.max(0, (x - field.originX) / field.spacing));
  const fz = Math.min(field.rows - 1, Math.max(0, (z - field.originZ) / field.spacing));
  const c0 = Math.min(field.cols - 2, Math.floor(fx));
  const r0 = Math.min(field.rows - 2, Math.floor(fz));
  const tx = fx - c0;
  const tz = fz - r0;
  const h = (r, c) => field.heights[r * field.cols + c];
  return (h(r0, c0) * (1 - tx) + h(r0, c0 + 1) * tx) * (1 - tz)
    + (h(r0 + 1, c0) * (1 - tx) + h(r0 + 1, c0 + 1) * tx) * tz;
}

// ─── Loading (browser) ───────────────────────────────────────────────────────

async function fetchTileHeights(apiBase, z, x, y, signal) {
  const response = await fetch(`${apiBase}/api/terrain/${TERRAIN_PROVIDER}/${z}/${x}/${y}.png`, { signal });
  if (!response.ok) return null;
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return decodeTerrarium(ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data);
}

/**
 * Load terrain for a route from the backend.
 * @param {Array<{ lat, lng, ele }>} points  route points
 * @returns {Promise<{ field, projection, bounds, zoom, tilesLoaded, tilesTotal }>}
 */
export async function loadTerrain(points, { apiBase = '', signal } = {}) {
  const bounds = routeBounds(points);
  const projection = createLocalProjection((bounds.minLat + bounds.maxLat) / 2, (bounds.minLng + bounds.maxLng) / 2);
  const zoom = chooseZoom(bounds);
  const range = tileRange(bounds, zoom);

  const requests = [];
  for (let x = range.minX; x <= range.maxX; x++) {
    for (let y = range.minY; y <= range.maxY; y++) {
      requests.push(
        fetchTileHeights(apiBase, zoom, x, y, signal)
          .then(heights => [`${x}/${y}`, heights])
          .catch(err => {
            if (err.name === 'AbortError') throw err;
            return [`${x}/${y}`, null];
          })
      );
    }
  }
  const results = await Promise.all(requests);
  const tiles = new Map(results.filter(([, h]) => h));

  const elevations = points.map(p => p.ele).filter(Number.isFinite);
  const fallbackHeight = elevations.length ? elevations.reduce((a, b) => a + b, 0) / elevations.length : 0;
  const field = buildHeightField({ tiles, z: zoom, bounds, projection, fallbackHeight });

  return { field, projection, bounds, zoom, tilesLoaded: tiles.size, tilesTotal: requests.length };
}
