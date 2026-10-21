/**
 * Route elevation profile — smoothed grade for GPX routes.
 *
 * Raw GPX elevation is noisy (GPS / barometer jitter of a few metres), and
 * track points can be only a few metres apart, so the grade between two
 * neighbouring points can spike to ±20 % on a flat road. Instead, elevation
 * is averaged over a centred distance window, and grade is derived from that
 * smoothed elevation on an even sampling grid.
 *
 * The window average is the exact integral of the piecewise-linear GPX
 * elevation, so every track point contributes; point-sampling first would
 * alias fine-grained noise into slow, grade-sized wobbles.
 *
 * Distances in the input points are in km (`distanceFromStart`), matching
 * RoutePage's parsed GPX points.
 */

export const SAMPLE_SPACING_M = 10;
export const SMOOTHING_WINDOW_M = 100;
export const MAX_GRADE_PERCENT = 25;

/**
 * Build a smoothed profile from parsed route points.
 * @param {Array<{ distanceFromStart: number, ele: number }>} points
 * @param {{ spacingM?: number, windowM?: number }} [options]
 * @returns {{ spacingM: number, elevations: number[], grades: number[], totalDistanceM: number }}
 */
export function buildRouteProfile(points, { spacingM = SAMPLE_SPACING_M, windowM = SMOOTHING_WINDOW_M } = {}) {
  const empty = { spacingM, elevations: [], grades: [], totalDistanceM: 0 };
  if (!points || points.length === 0) return empty;

  const xs = points.map(p => p.distanceFromStart * 1000);
  const es = points.map(p => p.ele);
  const totalDistanceM = xs[xs.length - 1];
  const count = Math.max(1, Math.floor(totalDistanceM / spacingM) + 1);

  // Cumulative integral of elevation over distance at each track point
  const cumulative = new Array(points.length);
  cumulative[0] = 0;
  for (let k = 1; k < points.length; k++) {
    cumulative[k] = cumulative[k - 1] + ((es[k - 1] + es[k]) / 2) * (xs[k] - xs[k - 1]);
  }

  // Index of the last track point at or before distance d
  const segmentAt = (d) => {
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (xs[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const elevationAtRaw = (d) => {
    const k = segmentAt(d);
    if (k >= points.length - 1 || xs[k + 1] === xs[k]) return es[k];
    return es[k] + ((es[k + 1] - es[k]) * (d - xs[k])) / (xs[k + 1] - xs[k]);
  };

  // ∫₀ᵈ elevation(x) dx
  const integralTo = (d) => {
    const k = segmentAt(d);
    const t = d - xs[k];
    return cumulative[k] + ((es[k] + elevationAtRaw(d)) / 2) * t;
  };

  const halfWindow = windowM / 2;
  const positions = new Array(count);
  const elevations = new Array(count);
  for (let i = 0; i < count; i++) {
    const d = Math.min(i * spacingM, totalDistanceM);
    positions[i] = d;
    const lo = Math.max(0, d - halfWindow);
    const hi = Math.min(totalDistanceM, d + halfWindow);
    elevations[i] = hi > lo ? (integralTo(hi) - integralTo(lo)) / (hi - lo) : elevationAtRaw(d);
  }

  // Grade for the stretch starting at each sample (the last sample reuses
  // the stretch leading into it)
  const rawGrades = elevations.map((_, i) => {
    const from = i === count - 1 ? i - 1 : i;
    if (from < 0) return 0;
    return gradeBetween(elevations[from], elevations[from + 1], positions[from + 1] - positions[from]);
  });

  // A box average lets noise at its window edges straight into the slope, so
  // average the grade over the same window again (a triangular kernel overall)
  const grades = movingAverage(rawGrades, Math.round(windowM / spacingM / 2));

  return { spacingM, elevations, grades, totalDistanceM };
}

function movingAverage(values, half) {
  if (half <= 0) return values.slice();
  const prefix = [0];
  for (const v of values) prefix.push(prefix[prefix.length - 1] + v);
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    return (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  });
}

function gradeBetween(fromEle, toEle, distanceM) {
  if (!(distanceM > 0)) return 0;
  const grade = ((toEle - fromEle) / distanceM) * 100;
  return Math.max(-MAX_GRADE_PERCENT, Math.min(MAX_GRADE_PERCENT, grade));
}

function sampleAt(values, spacingM, distanceKm) {
  if (values.length === 0) return 0;
  const pos = Math.max(0, (distanceKm * 1000) / spacingM);
  const i = Math.min(values.length - 1, Math.floor(pos));
  const next = Math.min(values.length - 1, i + 1);
  const t = pos - i;
  return values[i] + (values[next] - values[i]) * Math.min(1, t);
}

/** Smoothed grade (%) at a distance along the route (km). */
export function gradeAt(profile, distanceKm) {
  return sampleAt(profile.grades, profile.spacingM, distanceKm);
}

/** Smoothed elevation (m) at a distance along the route (km). */
export function elevationAt(profile, distanceKm) {
  return sampleAt(profile.elevations, profile.spacingM, distanceKm);
}

/**
 * Total climbing (m) from the smoothed profile, optionally up to a distance.
 * Raw GPX noise inflates elevation gain; the smoothed profile does not.
 */
export function elevationGain(profile, upToKm = Infinity) {
  const last = Math.min(
    profile.elevations.length - 1,
    Math.floor((upToKm * 1000) / profile.spacingM)
  );
  let gain = 0;
  for (let i = 1; i <= last; i++) {
    const diff = profile.elevations[i] - profile.elevations[i - 1];
    if (diff > 0) gain += diff;
  }
  return gain;
}

/**
 * Interpolated { lat, lng } at a distance along the route (km).
 * @param {Array<{ lat: number, lng: number, distanceFromStart: number }>} points
 */
export function positionAt(points, distanceKm) {
  if (!points || points.length === 0) return null;
  if (distanceKm <= points[0].distanceFromStart) return { lat: points[0].lat, lng: points[0].lng };
  let lo = 0;
  let hi = points.length - 1;
  if (distanceKm >= points[hi].distanceFromStart) return { lat: points[hi].lat, lng: points[hi].lng };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].distanceFromStart <= distanceKm) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.distanceFromStart - a.distanceFromStart;
  const t = span > 0 ? (distanceKm - a.distanceFromStart) / span : 0;
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}
