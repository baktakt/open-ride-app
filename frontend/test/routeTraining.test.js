import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeTrainingTarget, routeTrainingProfile } from '../src/services/routeTraining.js';

test('a flat Whitechapel ride has meaningful automatic loads without depending on elevation or controls', () => {
  const total = 12.3;
  assert.equal(routeTrainingTarget(0, total, 200).watts, 100);
  assert.equal(routeTrainingTarget(total * .15, total, 200).watts, 140);
  assert.equal(routeTrainingTarget(total * .60, total, 200).watts, 170);
  assert.equal(routeTrainingTarget(total * .66, total, 200).watts, 120);
  assert.equal(routeTrainingTarget(total, total, 200).watts, 90);
});

test('the full workout fits any route length and scales to rider FTP', () => {
  assert.equal(routeTrainingTarget(50, 100, 300).watts, Math.round(routeTrainingTarget(5, 10, 200).watts * 1.5));
  assert.equal(routeTrainingTarget(1000, 10, 200).name, 'Cool-down');
  assert.ok(Number.isFinite(routeTrainingTarget(0, 0, undefined).watts));
  assert.equal(routeTrainingProfile().at(-1).end, 1);
});
