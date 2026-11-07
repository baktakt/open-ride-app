import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeSpeedKmh, speedFromPower } from '../src/services/cyclingPhysics.js';

const kmh = ms => ms * 3.6;

test('200 W on the flat is a plausible road speed', () => {
  const v = kmh(speedFromPower(200, 0));
  assert.ok(v > 30 && v < 36, `got ${v}`);
});

test('climbing is slower than the flat at the same power', () => {
  const flat = speedFromPower(250, 0);
  const climb = speedFromPower(250, 8);
  assert.ok(kmh(climb) < 15 && climb < flat / 2, `got ${kmh(climb)}`);
});

test('descending without pedalling still moves', () => {
  assert.ok(kmh(speedFromPower(0, -6)) > 40);
});

test('no power on the flat means standing still', () => {
  assert.equal(speedFromPower(0, 0), 0);
});

test('route progress depends on power and gradient regardless of cog, with a speed-only fallback', () => {
  const trainer = { hasPower: true, power: 160, speed: 20 };
  const speed = routeSpeedKmh(trainer, 0, 82, true);
  assert.equal(routeSpeedKmh({ ...trainer, speed: 40 }, 0, 82, true), speed);
  assert.ok(routeSpeedKmh(trainer, 5, 82, true) < speed);
  assert.equal(routeSpeedKmh({ ...trainer, power: 0 }, 0, 82, true), 0);
  assert.equal(routeSpeedKmh(trainer, -5, 82, false), 0);
  assert.equal(routeSpeedKmh({ speed: 18 }, 0, 82, true), 18);
});
