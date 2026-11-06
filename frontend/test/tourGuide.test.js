import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupGuideStops } from '../src/services/tourGuide.js';
const landmark = { title: 'A lake' };

test('coincident guide stops share one sign and retain active and heard states', () => {
  const signs = groupGuideStops([
    { id: '1', distanceKm: 0, landmark, status: 'heard' },
    { id: '2', distanceKm: 0.02, landmark: { ...landmark, title: 'Church' }, status: 'active' },
    { id: '3', distanceKm: 1, landmark, status: 'upcoming' },
  ]);
  assert.equal(signs.length, 2);
  assert.equal(signs[0].status, 'active');
  assert.ok(signs[0].label.includes('Church'));
  assert.equal(signs[0].members.length, 2);
});
