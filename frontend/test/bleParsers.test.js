import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIndoorBikeData,
  parseCyclingPowerMeasurement,
  updateCrankCadence,
  parseHeartRateMeasurement,
  encodeTargetResistance,
  parseResistanceRange,
} from '../src/services/bleParsers.js';

const view = bytes => new DataView(new Uint8Array(bytes).buffer);
const bytesOf = buffer => Array.from(new Uint8Array(buffer));

test('Indoor Bike Data: speed, cadence and power', () => {
  // flags 0x0044: cadence + power present, speed present (bit 0 clear)
  const t = parseIndoorBikeData(view([0x44, 0x00, 0xC4, 0x09, 0xB4, 0x00, 0xFA, 0x00]));
  assert.equal(t.speed, 25);                 // 2500 × 0.01 km/h
  assert.equal(t.instantaneousCadence, 90);  // 180 × 0.5
  assert.equal(t.instantaneousPower, 250);
});

test('Indoor Bike Data "More Data" packet has no speed field', () => {
  // flags 0x0041: More Data + power
  const t = parseIndoorBikeData(view([0x41, 0x00, 0x2C, 0x01]));
  assert.equal(t.speed, undefined);
  assert.equal(t.instantaneousPower, 300);
});

test('Indoor Bike Data: distance, heart rate and elapsed time after skipped fields', () => {
  // flags: distance(4) | resistance(5) | power(6) | energy(8) | HR(9) | elapsed(11)
  const flags = 0x0010 | 0x0020 | 0x0040 | 0x0100 | 0x0200 | 0x0800;
  const t = parseIndoorBikeData(view([
    flags & 0xFF, flags >> 8,
    0x10, 0x27,             // speed 100.00 km/h
    0x39, 0x30, 0x00,       // distance 12345 m
    0x05, 0x00,             // resistance (skipped)
    0xC8, 0x00,             // power 200 W
    1, 2, 3, 4, 5,          // expended energy (skipped)
    142,                    // heart rate
    0x58, 0x02,             // elapsed 600 s
  ]));
  assert.equal(t.distance, 12345);
  assert.equal(t.instantaneousPower, 200);
  assert.equal(t.heartRate, 142);
  assert.equal(t.elapsedTime, 600);
});

test('CPS: crank data is found after accumulated torque (2 bytes)', () => {
  // flags: torque present (bit 2) + crank data (bit 5)
  const m = parseCyclingPowerMeasurement(view([
    0x24, 0x00, 0xF0, 0x00, // power 240
    0x11, 0x22,             // accumulated torque
    0x0A, 0x00, 0x00, 0x04, // crank revs 10, event time 1024
  ]));
  assert.equal(m.instantaneousPower, 240);
  assert.deepEqual(m.crank, { revs: 10, eventTime: 1024 });
});

test('crank cadence from successive readings, including roll-over', () => {
  let r = updateCrankCadence(null, { revs: 65535, eventTime: 65000 }, 0);
  assert.equal(r.cadence, undefined);
  // 1.5 revs/s → 90 rpm; both counters wrap
  r = updateCrankCadence(r.state, { revs: 2, eventTime: (65000 + 2048) & 0xFFFF }, 2000);
  assert.equal(Math.round(r.cadence), 90);
});

test('crank cadence holds on repeated events, then drops to 0 when pedalling stops', () => {
  let r = updateCrankCadence(null, { revs: 0, eventTime: 0 }, 0);
  r = updateCrankCadence(r.state, { revs: 1, eventTime: 683 }, 700); // ~90 rpm
  r = updateCrankCadence(r.state, { revs: 1, eventTime: 683 }, 1200);
  assert.equal(Math.round(r.cadence), 90);
  r = updateCrankCadence(r.state, { revs: 1, eventTime: 683 }, 4000);
  assert.equal(r.cadence, 0);
});

test('heart rate measurement in uint8 and uint16 formats', () => {
  assert.equal(parseHeartRateMeasurement(view([0x00, 145])), 145);
  assert.equal(parseHeartRateMeasurement(view([0x01, 0x2C, 0x01])), 300);
});

test('target resistance is a UINT8 (0.1 resolution) within the FTMS v1.0 range', () => {
  const { buffer, level } = encodeTargetResistance(50, { min: 0, max: 20 });
  assert.deepEqual(bytesOf(buffer), [0x04, 100]);
  assert.equal(level, 10);
});

test('target resistance falls back to SINT16 for ranges beyond 25.5', () => {
  const { buffer } = encodeTargetResistance(100, { min: 0, max: 100 });
  assert.deepEqual(bytesOf(buffer), [0x04, 0xE8, 0x03]); // 1000
});

test('supported resistance level range parsing', () => {
  assert.deepEqual(parseResistanceRange(view([0x00, 0x00, 0xC8, 0x00, 0x0A, 0x00])), { min: 0, max: 20 });
  assert.equal(parseResistanceRange(view([0x00, 0x00, 0x00, 0x00])), null);
});
