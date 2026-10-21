import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRideRecorder } from '../src/services/rideRecorder.js';

function fakeClock() {
  let t = 0;
  return { now: () => t, advance: ms => { t += ms; } };
}

test('records one sample per elapsed second', () => {
  const clock = fakeClock();
  const rec = createRideRecorder({ now: clock.now });
  rec.start();
  for (let i = 0; i < 40; i++) {
    clock.advance(250);
    rec.tick({ power: 150 });
  }
  assert.equal(rec.elapsedSeconds, 10);
  assert.ok(rec.samples.every(s => s.power === 150));
});

test('back-fills seconds when timer callbacks are throttled', () => {
  const clock = fakeClock();
  const rec = createRideRecorder({ now: clock.now });
  rec.start();
  clock.advance(60_000); // background tab: one callback per minute
  assert.equal(rec.tick({ power: 200 }), 60);
  assert.equal(rec.elapsedSeconds, 60);
});

test('paused time is not counted', () => {
  const clock = fakeClock();
  const rec = createRideRecorder({ now: clock.now });
  rec.start();
  clock.advance(5000);
  rec.tick({});
  rec.pause();
  clock.advance(30_000);
  assert.equal(rec.tick({}), 0);
  rec.resume();
  clock.advance(5000);
  rec.tick({});
  assert.equal(rec.elapsedSeconds, 10);
});

test('extra fields are stored on samples', () => {
  const clock = fakeClock();
  const rec = createRideRecorder({ now: clock.now });
  rec.start();
  clock.advance(1000);
  rec.tick({ power: 100 }, { targetPower: 180 });
  assert.equal(rec.samples[0].targetPower, 180);
});

test('samples carry wall-clock timestamps with pauses as gaps', () => {
  let mono = 0;
  let wall = 1_700_000_000_000;
  const rec = createRideRecorder({ now: () => mono, wallNow: () => wall });
  const advance = ms => { mono += ms; wall += ms; };
  rec.start();
  assert.equal(rec.startedAt, 1_700_000_000_000);
  advance(2000);
  rec.tick({});
  rec.pause();
  wall += 60_000; mono += 60_000; // paused for a minute
  rec.resume();
  advance(1000);
  rec.tick({});
  assert.deepEqual(rec.samples.map(s => s.timestamp - rec.startedAt), [1000, 2000, 63000]);
});

test('back-filled samples get evenly spaced timestamps', () => {
  let mono = 0;
  let wall = 0;
  const rec = createRideRecorder({ now: () => mono, wallNow: () => wall });
  rec.start();
  mono += 3500; wall += 3500;
  rec.tick({});
  assert.deepEqual(rec.samples.map(s => s.timestamp), [1000, 2000, 3000]);
});
