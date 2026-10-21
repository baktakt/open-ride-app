import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_TELEMETRY, mergeTelemetry } from '../src/services/telemetry.js';

test('fields missing from a packet keep their last value', () => {
  const lastSeen = {};
  let t = mergeTelemetry(EMPTY_TELEMETRY, { instantaneousPower: 210, instantaneousCadence: 88 }, lastSeen, 1000);
  t = mergeTelemetry(t, { speed: 32.5 }, lastSeen, 1250); // e.g. FTMS "More Data" packet
  assert.equal(t.power, 210);
  assert.equal(t.cadence, 88);
  assert.equal(t.speed, 32.5);
});

test('a real 0 W reading is applied', () => {
  const lastSeen = {};
  let t = mergeTelemetry(EMPTY_TELEMETRY, { instantaneousPower: 210 }, lastSeen, 1000);
  t = mergeTelemetry(t, { instantaneousPower: 0 }, lastSeen, 1250);
  assert.equal(t.power, 0);
});

test('instantaneous fields go stale, cumulative fields do not', () => {
  const lastSeen = {};
  let t = mergeTelemetry(EMPTY_TELEMETRY, { heartRate: 150, distance: 1200 }, lastSeen, 1000);
  t = mergeTelemetry(t, { instantaneousPower: 100 }, lastSeen, 7000);
  assert.equal(t.heartRate, 0);
  assert.equal(t.distance, 1200);
});
