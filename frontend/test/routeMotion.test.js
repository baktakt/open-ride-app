import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteMotion } from '../src/services/routeMotion.js';

test('one-second distance updates produce steady forward motion at render frequency', () => {
  const motion = createRouteMotion();
  let previous = motion(0, 36, true, 0, 0);
  const steps = [];
  for (let frame = 1; frame <= 600; frame++) {
    const now = frame * 1000 / 60;
    const shown = motion(Math.floor(frame / 60) * 10, 36, true, now, 1 / 60);
    steps.push(shown - previous);
    previous = shown;
  }
  assert.ok(previous > 99 && previous < 101);
  assert.ok(Math.min(...steps) > 0.15);
  assert.ok(Math.max(...steps) < 0.18);
});

test('pause holds the reported position and restart resets the visual distance', () => {
  const motion = createRouteMotion(100);
  motion(100, 36, true, 0, 0);
  motion(100, 36, true, 500, 0.1);
  assert.equal(motion(100, 36, false, 600, 0.1), 100);
  assert.equal(motion(100, 36, false, 1600, 0.1), 100);
  assert.equal(motion(0, 0, true, 1700, 0.1), 0);
});
