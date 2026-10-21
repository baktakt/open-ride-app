import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizedPower,
  trainingStressScore,
  distanceCovered,
  computeRideMetrics,
  estimatePlannedLoad,
} from '../src/services/rideMetrics.js';

const steady = (seconds, power, extra = {}) =>
  Array.from({ length: seconds }, () => ({ power, cadence: 90, heartRate: 140, ...extra }));

test('NP equals average power for a steady effort', () => {
  assert.equal(Math.round(normalizedPower(Array(600).fill(200))), 200);
});

test('NP is higher than average power for variable efforts', () => {
  const powers = [];
  for (let i = 0; i < 20; i++) {
    powers.push(...Array(60).fill(300), ...Array(60).fill(100));
  }
  const avg = powers.reduce((a, b) => a + b, 0) / powers.length;
  assert.equal(avg, 200);
  assert.ok(normalizedPower(powers) > 230);
});

test('one hour at FTP is 100 TSS', () => {
  assert.equal(Math.round(trainingStressScore(3600, 250, 250)), 100);
});

test('average power includes coasting at 0 W', () => {
  const samples = [...steady(60, 200), ...steady(60, 0, { cadence: 0 })];
  const m = computeRideMetrics(samples, 200);
  assert.equal(m.avgPower, 100);
  assert.equal(m.avgCadence, 90); // zero cadence excluded
  assert.equal(m.kilojoules, 12);
});

test('distance is measured from the first sample, not from trainer power-on', () => {
  const samples = [5000, 5010, 5025, 5040].map(distance => ({ power: 100, distance }));
  assert.equal(distanceCovered(samples), 40);
});

test('distance survives a trainer counter reset', () => {
  const samples = [100, 150, 200, 0, 30, 60].map(distance => ({ distance }));
  assert.equal(distanceCovered(samples), 160);
});

test('IF is NP / FTP', () => {
  const m = computeRideMetrics(steady(3600, 225), 250);
  assert.equal(m.intensityFactor, '0.90');
  assert.equal(m.tss, 81);
});

test('planned load: one hour at 100 % FTP is 100 TSS', () => {
  assert.equal(estimatePlannedLoad(Array(3600).fill(1)).tss, 100);
});
