import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExecutionPlan,
  targetPowerAt,
  rampEndpoints,
  buildTextEvents,
  activeTextEvent,
  MAX_EFFORT_RESISTANCE,
} from '../src/services/workoutPlan.js';

const FTP = 200;

test('warmup ramps up across the segment instead of holding the average', () => {
  const [warmup] = buildExecutionPlan(
    [{ type: 'Warmup', duration: 301, powerLow: 0.4, powerHigh: 0.65, textEvents: [] }], FTP
  );
  assert.equal(targetPowerAt(warmup, 0), 80);
  assert.equal(targetPowerAt(warmup, 150), 105);
  assert.equal(targetPowerAt(warmup, 300), 130);
});

test('cooldown ramps down for both attribute conventions', () => {
  // Open Ride library style: PowerHigh > PowerLow
  assert.deepEqual(rampEndpoints({ type: 'Cooldown', powerLow: 0.35, powerHigh: 0.55 }), [0.55, 0.35]);
  // Zwift style: PowerLow is the start
  assert.deepEqual(rampEndpoints({ type: 'Cooldown', powerLow: 0.75, powerHigh: 0.25 }), [0.75, 0.25]);
});

test('a plain Ramp is taken literally and may ramp down', () => {
  assert.deepEqual(rampEndpoints({ type: 'Ramp', powerLow: 0.68, powerHigh: 0.55 }), [0.68, 0.55]);
});

test('MaxEffort and FreeRide are kept as resistance-mode segments', () => {
  const plan = buildExecutionPlan([
    { type: 'SteadyState', duration: 60, power: 0.6, textEvents: [] },
    { type: 'MaxEffort', duration: 20, textEvents: [] },
    { type: 'FreeRide', duration: 120, textEvents: [] },
  ], FTP);
  assert.equal(plan.length, 3);
  assert.equal(plan.reduce((sum, s) => sum + s.duration, 0), 200);
  assert.equal(plan[1].mode, 'resistance');
  assert.equal(plan[1].resistance, MAX_EFFORT_RESISTANCE);
  assert.equal(targetPowerAt(plan[1], 5), null);
  assert.equal(plan[2].mode, 'resistance');
});

test('intervals expand into on/off segments', () => {
  const plan = buildExecutionPlan([{
    type: 'IntervalsT', duration: 0, repeat: 3, onDuration: 30, offDuration: 60,
    onPower: 1.2, offPower: 0.5, cadence: 100, cadenceResting: 85, textEvents: [],
  }], FTP);
  assert.equal(plan.length, 6);
  assert.deepEqual(plan.map(s => s.targetPower), [240, 100, 240, 100, 240, 100]);
  assert.equal(plan[0].targetCadence, 100);
  assert.equal(plan[1].targetCadence, 85);
});

test('text events are placed on the absolute timeline with their offsets', () => {
  const events = buildTextEvents([
    { type: 'Warmup', duration: 300, powerLow: 0.4, powerHigh: 0.6, textEvents: [
      { timeoffset: 0, message: 'Welcome' },
      { timeoffset: 120, message: 'Halfway through warmup' },
    ] },
    { type: 'SteadyState', duration: 60, power: 0.8, textEvents: [{ timeoffset: 30, message: 'Hold it' }] },
  ]);
  assert.deepEqual(events.map(e => e.time), [0, 120, 330]);
  assert.equal(activeTextEvent(events, 125).message, 'Halfway through warmup');
  assert.equal(activeTextEvent(events, 200), null); // expired
  assert.equal(activeTextEvent(events, 335).message, 'Hold it');
});

test('interval sets without messages get generated cues', () => {
  const events = buildTextEvents([{
    type: 'IntervalsT', repeat: 2, onDuration: 30, offDuration: 30, onPower: 1, offPower: 0.5, textEvents: [],
  }]);
  assert.deepEqual(events.map(e => e.time), [0, 30, 60, 90]);
});
