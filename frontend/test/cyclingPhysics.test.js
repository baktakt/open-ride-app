import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speedFromPower } from '../src/services/cyclingPhysics.js';

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
