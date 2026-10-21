import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFit, buildTcx, prepareTrack, fitCrc, rideFileName } from '../src/services/rideExport.js';

const START = Date.UTC(2026, 9, 21, 17, 0, 0);

function ride({ seconds = 120, route = false, pauseAfter = null, name = 'Test Ride' } = {}) {
  const samples = [];
  let wall = START;
  for (let t = 1; t <= seconds; t++) {
    wall += 1000;
    if (t === pauseAfter + 1) wall += 20_000;
    const s = { t, timestamp: wall, power: 200, cadence: 90, heartRate: t % 2 ? 140 : 0, speed: 36, distance: 1000 + t * 10 };
    if (route) Object.assign(s, { routeDistance: t * 10, lat: 59.3 + t * 1e-4, lng: 18.0, altitude: 20 + t * 0.5 });
    samples.push(s);
  }
  return { id: 1792600000000, type: route ? 'route' : 'workout', name, startTime: new Date(START).toISOString(), ftp: 250, samples };
}

test('distance starts at 0 from the trainer counter, or follows the route', () => {
  const workout = prepareTrack(ride());
  assert.equal(workout[0].distance, 0);
  assert.equal(workout[119].distance, 1190);
  const route = prepareTrack(ride({ route: true }));
  assert.equal(route[0].distance, 10);
  assert.equal(route[119].distance, 1200);
});

test('distance falls back to integrating speed when the trainer has no counter', () => {
  const r = ride({ seconds: 10 });
  r.samples.forEach(s => { delete s.distance; });
  assert.equal(prepareTrack(r)[9].distance, 100); // 36 km/h = 10 m/s
});

test('FIT file has a valid header, data size and CRCs', () => {
  const bytes = buildFit(ride({ route: true, pauseAfter: 60 }));
  const view = new DataView(bytes.buffer);
  assert.equal(bytes[0], 14);
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), '.FIT');
  assert.equal(view.getUint32(4, true), bytes.length - 16);
  assert.equal(view.getUint16(12, true), fitCrc(bytes, 0, 12));
  assert.equal(fitCrc(bytes), 0); // CRC over data + its own CRC is zero
});

test('FIT CRC matches the Garmin FIT SDK for a known header', () => {
  // Reference value from @garmin/fitsdk CrcCalculator.calculateCRC
  const header = new Uint8Array([0x0E, 0x10, 0x43, 0x08, 0x78, 0x06, 0x09, 0x00, 0x2E, 0x46, 0x49, 0x54]);
  assert.equal(fitCrc(header), 0x8596);
  assert.equal(fitCrc(new Uint8Array([])), 0);
});

test('TCX contains one trackpoint per second and escapes the name', () => {
  const tcx = buildTcx(ride({ route: true, name: 'Hills & <Valleys>' }));
  assert.equal((tcx.match(/<Trackpoint>/g) || []).length, 120);
  assert.ok(tcx.includes('<Notes>Hills &amp; &lt;Valleys&gt;</Notes>'));
  assert.ok(tcx.includes('<LatitudeDegrees>'));
  assert.ok(tcx.includes('<ns3:Watts>200</ns3:Watts>'));
});

test('TCX omits zero heart rate and positions for indoor workouts', () => {
  const tcx = buildTcx(ride());
  assert.ok(!tcx.includes('<Value>0</Value>'));
  assert.ok(!tcx.includes('<Position>'));
  assert.ok(tcx.includes('<HeartRateBpm><Value>140</Value></HeartRateBpm>'));
});

test('file names are dated and slugged', () => {
  const name = rideFileName(ride({ name: 'Sweet Spot Surge!' }), 'fit');
  assert.match(name, /^open-ride-2026-10-21-\d{4}-sweet-spot-surge\.fit$/);
});
