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
