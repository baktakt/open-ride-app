import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRouteProfile, gradeAt, elevationAt, elevationGain } from '../src/services/routeProfile.js';

// Points every `stepM` metres with elevation from eleFn(distanceM)
function route(lengthM, stepM, eleFn) {
  const points = [];
  for (let d = 0; d <= lengthM; d += stepM) {
    points.push({ distanceFromStart: d / 1000, ele: eleFn(d) });
  }
  return points;
}

// Deterministic ±amp metre "GPS noise"
const noise = (d, amp) => amp * Math.sin(d * 1.7) * Math.cos(d * 0.31);

const rawMaxGrade = points => {
  let max = 0;
  for (let i = 1; i < points.length; i++) {
    const dist = (points[i].distanceFromStart - points[i - 1].distanceFromStart) * 1000;
    if (dist > 0) max = Math.max(max, Math.abs((points[i].ele - points[i - 1].ele) / dist * 100));
  }
  return max;
};

test('noisy flat road: raw grade spikes, smoothed grade stays near 0', () => {
  const points = route(3000, 5, d => 50 + noise(d, 1.5));
  assert.ok(rawMaxGrade(points) > 20, 'test data should reproduce the spike problem');

  const profile = buildRouteProfile(points);
  for (let km = 0.1; km < 2.9; km += 0.01) {
    assert.ok(Math.abs(gradeAt(profile, km)) < 0.3, `grade ${gradeAt(profile, km)} at ${km} km`);
  }
});

test('steady 6 % climb is preserved through the noise', () => {
  const points = route(3000, 5, d => 0.06 * d + noise(d, 1.5));
  const profile = buildRouteProfile(points);
  for (let km = 0.2; km < 2.8; km += 0.05) {
    assert.ok(Math.abs(gradeAt(profile, km) - 6) < 0.3, `grade ${gradeAt(profile, km)} at ${km} km`);
  }
});

test('climb starting after a flat section ramps in over the smoothing window', () => {
  const points = route(4000, 20, d => (d < 2000 ? 10 : 10 + 0.08 * (d - 2000)));
  const profile = buildRouteProfile(points);
  assert.ok(Math.abs(gradeAt(profile, 1.5)) < 0.1);
  assert.ok(Math.abs(gradeAt(profile, 3.0) - 8) < 0.1);
  const mid = gradeAt(profile, 2.0);
  assert.ok(mid > 0 && mid < 8);
});

test('elevation gain ignores noise', () => {
  const flat = buildRouteProfile(route(3000, 5, d => 50 + noise(d, 1.5)));
  assert.ok(elevationGain(flat) < 5, `gain ${elevationGain(flat)}`);

  const climb = buildRouteProfile(route(2000, 10, d => 0.05 * d));
  assert.ok(Math.abs(elevationGain(climb) - 100) < 5);
  assert.ok(Math.abs(elevationGain(climb, 1) - 50) < 5); // gain up to 1 km
});

test('uneven spacing and duplicate points are handled', () => {
  const points = [
    { distanceFromStart: 0, ele: 0 },
    { distanceFromStart: 0, ele: 0 },        // duplicate
    { distanceFromStart: 0.003, ele: 0.15 },
    { distanceFromStart: 0.5, ele: 25 },
    { distanceFromStart: 1, ele: 50 },
  ];
  const profile = buildRouteProfile(points);
  assert.ok(Math.abs(gradeAt(profile, 0.5) - 5) < 0.1);
  assert.ok(Math.abs(elevationAt(profile, 0.5) - 25) < 1);
});

test('extreme grades are clamped and empty routes are safe', () => {
  const wall = buildRouteProfile(route(500, 10, d => (d < 250 ? 0 : 100)), { windowM: 0 });
  assert.equal(Math.max(...wall.grades), 25);
  assert.equal(gradeAt(buildRouteProfile([]), 1), 0);
  assert.equal(gradeAt(buildRouteProfile([{ distanceFromStart: 0, ele: 10 }]), 0), 0);
});
