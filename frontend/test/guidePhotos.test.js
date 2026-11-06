import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guidePhotoQuery, guidePhotoStops } from '../src/services/guidePhotos.js';

test('guide photos resolve an exact source article or a curated landmark, never arbitrary businesses', () => {
  assert.deepEqual(guidePhotoQuery({ title: 'Greystone: a house with a screen career' }), { title: 'Greystone Mansion', language: 'en' });
  assert.deepEqual(guidePhotoQuery({ title: 'A creative story title', sources: [{ url: 'https://sv.wikipedia.org/?curid=123' }] }), { pageId: '123', language: 'sv' });
  assert.deepEqual(guidePhotoQuery({ sources: [{ url: 'https://en.wikipedia.org/wiki/Greystone_Mansion' }] }), { title: 'Greystone Mansion', language: 'en' });
  assert.equal(guidePhotoQuery({ title: 'Unknown place', sources: [{ url: 'https://example.com' }] }), null);
});

test('the photo panel keeps the spoken place first, then prepares upcoming places', () => {
  const stops = [{ id: 'a', distanceKm: 0, status: 'heard' }, { id: 'b', distanceKm: 2, status: 'upcoming' }, { id: 'c', distanceKm: 4, status: 'upcoming' }];
  assert.deepEqual(guidePhotoStops(stops, 1, 'b').map(stop => stop.id), ['b', 'c']);
  assert.equal(guidePhotoStops(stops, 1)[0].id, 'a');
  assert.equal(guidePhotoStops(stops.map(stop => ({ ...stop, status: 'upcoming' })), .15)[0].id, 'a');
});
