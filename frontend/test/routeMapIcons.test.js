import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPhotoMarkers } from '../src/services/routeMapIcons.js';

const place = (name, lat, lng) => ({ name, location: { latitude: lat, longitude: lng } });

test('overlapping photo pins retain every place in one group while distant pins stay separate', () => {
  const places = [place('Museum', 0, 0), place('Gallery', 0, 20), place('Park', 0, 100), { name: 'Missing coordinates' }];
  const groups = groupPhotoMarkers(places, (lat, lng) => ({ x: lng, y: lat }));
  assert.deepEqual(groups.map(group => group.places.map(item => item.name)), [['Museum', 'Gallery'], ['Park']]);
});

test('zooming in separates nearby photos again', () => {
  const places = [place('Museum', 0, 0), place('Gallery', 0, 20)];
  assert.equal(groupPhotoMarkers(places, (lat, lng) => ({ x: lng, y: lat })).length, 1);
  assert.equal(groupPhotoMarkers(places, (lat, lng) => ({ x: lng * 3, y: lat * 3 })).length, 2);
});
