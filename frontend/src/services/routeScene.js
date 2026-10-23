/**
 * Route geometry for the 3D view — pure functions, unit tested.
 *
 * The road is the GPX track projected into the local metric frame (see
 * terrain.js) and resampled at even spacing, draped onto the terrain height
 * field so it always sits on the rendered ground.
 */

import { heightAt } from './terrain.js';

export const ROAD_SAMPLE_SPACING_M = 5;
export const ROAD_HEIGHT_OFFSET_M = 0.3;   // keeps the road surface above the terrain mesh

/**
 * Even-spaced road path along the route.
 * @param {Array<{ lat, lng, distanceFromStart }>} points  route points (distance in km)
 * @returns {{ points: Array<{ x, y, z, d }>, length: number }}  d = metres along the route
 */
export function buildRoadPath(points, projection, field, spacingM = ROAD_SAMPLE_SPACING_M) {
  if (!points || points.length === 0) return { points: [], length: 0 };
  const local = points.map(p => ({ ...projection.toLocal(p.lat, p.lng), d: p.distanceFromStart * 1000 }));
  const length = local[local.length - 1].d;
  const count = Math.max(2, Math.floor(length / spacingM) + 1);
  const path = [];

  let j = 0;
  for (let i = 0; i < count; i++) {
    const d = i === count - 1 ? length : i * spacingM;
    while (j < local.length - 2 && local[j + 1].d < d) j++;
    const a = local[j];
    const b = local[Math.min(j + 1, local.length - 1)];
    const t = b.d > a.d ? Math.min(1, Math.max(0, (d - a.d) / (b.d - a.d))) : 0;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    path.push({ x, y: heightAt(field, x, z) + ROAD_HEIGHT_OFFSET_M, z, d });
  }
  return { points: path, length };
}

/** Interpolated { x, y, z } at a distance (metres) along the path; clamped to its ends. */
export function pointAt(path, distanceM) {
  const pts = path.points;
  if (pts.length === 0) return { x: 0, y: 0, z: 0 };
  if (distanceM <= pts[0].d) return { ...pts[0] };
  if (distanceM >= pts[pts.length - 1].d) return { ...pts[pts.length - 1] };

  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].d <= distanceM) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const t = b.d > a.d ? (distanceM - a.d) / (b.d - a.d) : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * Left/right edge vertices of a road ribbon, one pair per path point.
 * Directions are averaged over neighbours so corners do not pinch.
 */
export function roadRibbon(path, halfWidth) {
  const pts = path.points;
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    // Perpendicular in the ground plane (to the left of travel)
    const px = dz;
    const pz = -dx;
    const p = pts[i];
    left.push({ x: p.x + px * halfWidth, y: p.y, z: p.z + pz * halfWidth });
    right.push({ x: p.x - px * halfWidth, y: p.y, z: p.z - pz * halfWidth });
  }
  return { left, right };
}

/** Small deterministic PRNG (mulberry32) so scenery is identical on every load. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scatter trees beside the road: random offsets 15–350 m to either side of
 * random points along the route, rejecting spots too close to any part of
 * the road (where the route doubles back) and steep slopes.
 * @returns {Array<{ x, y, z, scale }>}
 */
export function scatterTrees(path, field, { count = 2500, seed = 1, minRoadDistance = 15, maxRoadDistance = 350 } = {}) {
  const pts = path.points;
  if (pts.length < 2) return [];
  const random = seededRandom(seed);

  // Spatial hash of road points for the "too close to the road" test
  const cell = minRoadDistance;
  const grid = new Map();
  const key = (cx, cz) => `${cx},${cz}`;
  for (const p of pts) {
    const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const nearRoad = (x, z) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) {
      for (let k = -1; k <= 1; k++) {
        for (const p of grid.get(key(cx + i, cz + k)) || []) {
          if (Math.hypot(p.x - x, p.z - z) < minRoadDistance) return true;
        }
      }
    }
    return false;
  };

  const trees = [];
  const maxAttempts = count * 4;
  for (let attempt = 0; attempt < maxAttempts && trees.length < count; attempt++) {
    const anchor = pts[Math.floor(random() * pts.length)];
    const angle = random() * Math.PI * 2;
    const dist = minRoadDistance + random() * (maxRoadDistance - minRoadDistance);
    const x = anchor.x + Math.cos(angle) * dist;
    const z = anchor.z + Math.sin(angle) * dist;
    if (nearRoad(x, z)) continue;

    const y = heightAt(field, x, z);
    const slope = Math.hypot(heightAt(field, x + 5, z) - y, heightAt(field, x, z + 5) - y) / 5;
    if (slope > 0.6) continue;

    trees.push({ x, y, z, scale: 0.7 + random() * 0.7 });
  }
  return trees;
}
