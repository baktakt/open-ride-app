import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { estimateTSS, loadAllWorkouts, normalizedPower } from '../src/workoutParser.js';

const workoutsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../workouts');

test('one hour at FTP is 100 TSS', () => {
  assert.equal(estimateTSS([{ type: 'SteadyState', duration: 3600, power: 1, textEvents: [] }]), 100);
});

test('intervals score higher than steady riding at the same average', () => {
  const steady = estimateTSS([{ type: 'SteadyState', duration: 3600, power: 0.75, textEvents: [] }]);
  const intervals = estimateTSS([{
    type: 'IntervalsT', duration: 0, repeat: 30, onDuration: 60, offDuration: 60,
    onPower: 1.0, offPower: 0.5, textEvents: [],
  }]);
  assert.ok(intervals > steady);
});

test('NP of a constant series is that constant', () => {
  assert.ok(Math.abs(normalizedPower(Array(120).fill(0.8)) - 0.8) < 1e-9);
});

test('all bundled workouts parse with elements', () => {
  const workouts = loadAllWorkouts(workoutsDir);
  assert.ok(workouts.length > 0);
  for (const w of workouts) {
    assert.ok(w.elements.length > 0, `${w.id} has no elements`);
    assert.ok(w.totalDuration > 0, `${w.id} has no duration`);
  }
});
