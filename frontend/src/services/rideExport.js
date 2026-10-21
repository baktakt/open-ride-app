/**
 * Ride export — turns a stored ride recording into a FIT or TCX file that
 * Strava, Garmin Connect, TrainingPeaks, intervals.icu etc. can import.
 *
 * Pure functions except downloadRide(). No dependencies: FIT is a small
 * binary format (header, definition + data messages, CRC-16) encoded here
 * directly, following the Garmin FIT protocol.
 *
 * Ride shape (see rideFiles.js):
 *   { id, type: 'workout'|'route', name, startTime (ISO), ftp, samples, summary }
 * Sample shape (see rideRecorder.js):
 *   { t, timestamp (ms), power, cadence, heartRate, speed (km/h), distance (m,
 *     trainer counter), routeDistance? (m), lat?, lng?, altitude? (m) }
 */

import { computeRideMetrics } from './rideMetrics.js';

// ─── Shared track preparation ────────────────────────────────────────────────

/**
 * Normalise samples into export track points with distance measured from the
 * start of the ride:
 *   - route rides: distance along the route (routeDistance)
 *   - otherwise: positive deltas of the trainer's distance counter, or speed
 *     integrated over time when the trainer reports no distance
 */
export function prepareTrack(ride) {
  const samples = ride.samples || [];
  const startMs = new Date(ride.startTime).getTime();
  let distance = 0;
  let prevCounter = null;

  return samples.map((s, i) => {
    if (typeof s.routeDistance === 'number') {
      distance = s.routeDistance;
    } else if (typeof s.distance === 'number' && Number.isFinite(s.distance)) {
      if (prevCounter !== null && s.distance >= prevCounter) distance += s.distance - prevCounter;
      prevCounter = s.distance;
    } else {
      distance += (s.speed || 0) / 3.6;
    }

    return {
      time: s.timestamp ?? startMs + (s.t ?? i + 1) * 1000,
      distance,
      power: Math.max(0, Math.round(s.power || 0)),
      cadence: Math.round(s.cadence || 0),
      heartRate: Math.round(s.heartRate || 0),
      speed: (s.speed || 0) / 3.6, // m/s
      lat: s.lat,
      lng: s.lng,
      altitude: s.altitude,
    };
  });
}

function hasPositions(track) {
  return track.length > 0 && track.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

function totalAscent(track) {
  let ascent = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1].altitude;
    const b = track[i].altitude;
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) ascent += b - a;
  }
  return ascent;
}

function summarise(ride, track) {
  const metrics = computeRideMetrics(ride.samples || [], ride.ftp || 0);
  const heartRates = track.map(p => p.heartRate).filter(hr => hr > 0);
  return {
    ...metrics,
    distance: track.length ? track[track.length - 1].distance : 0,
    maxSpeed: track.reduce((max, p) => Math.max(max, p.speed), 0),
    maxHeartRate: heartRates.length ? Math.max(...heartRates) : 0,
    ascent: totalAscent(track),
  };
}

export function rideFileName(ride, extension) {
  const date = new Date(ride.startTime);
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const slug = (ride.name || 'ride').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `open-ride-${stamp}-${slug || 'ride'}.${extension}`;
}

// ─── TCX ─────────────────────────────────────────────────────────────────────

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const isoTime = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Build a TCX (Training Center XML v2) document. Element order follows the
 * TrainingCenterDatabase v2 schema.
 */
export function buildTcx(ride) {
  const track = prepareTrack(ride);
  const summary = summarise(ride, track);
  const start = isoTime(new Date(ride.startTime).getTime());
  const positions = hasPositions(track);

  const trackpoints = track.map(p => {
    const parts = [`<Time>${isoTime(p.time)}</Time>`];
    if (positions) {
      parts.push(`<Position><LatitudeDegrees>${p.lat.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${p.lng.toFixed(7)}</LongitudeDegrees></Position>`);
    }
    if (Number.isFinite(p.altitude)) parts.push(`<AltitudeMeters>${p.altitude.toFixed(1)}</AltitudeMeters>`);
    parts.push(`<DistanceMeters>${p.distance.toFixed(1)}</DistanceMeters>`);
    if (p.heartRate > 0) parts.push(`<HeartRateBpm><Value>${Math.min(255, p.heartRate)}</Value></HeartRateBpm>`);
    parts.push(`<Cadence>${Math.min(254, p.cadence)}</Cadence>`);
    parts.push(`<Extensions><ns3:TPX><ns3:Speed>${p.speed.toFixed(2)}</ns3:Speed><ns3:Watts>${p.power}</ns3:Watts></ns3:TPX></Extensions>`);
    return `          <Trackpoint>${parts.join('')}</Trackpoint>`;
  });

  const lap = [
    `<TotalTimeSeconds>${summary.duration}</TotalTimeSeconds>`,
    `<DistanceMeters>${summary.distance.toFixed(1)}</DistanceMeters>`,
    `<MaximumSpeed>${summary.maxSpeed.toFixed(2)}</MaximumSpeed>`,
    `<Calories>${Math.min(65535, summary.calories)}</Calories>`,
    summary.avgHeartRate > 0 ? `<AverageHeartRateBpm><Value>${summary.avgHeartRate}</Value></AverageHeartRateBpm>` : '',
    summary.maxHeartRate > 0 ? `<MaximumHeartRateBpm><Value>${summary.maxHeartRate}</Value></MaximumHeartRateBpm>` : '',
    '<Intensity>Active</Intensity>',
    summary.avgCadence > 0 ? `<Cadence>${Math.min(254, summary.avgCadence)}</Cadence>` : '',
    '<TriggerMethod>Manual</TriggerMethod>',
  ].filter(Boolean).join('');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">',
    '  <Activities>',
    '    <Activity Sport="Biking">',
    `      <Id>${start}</Id>`,
    `      <Lap StartTime="${start}">`,
    `        ${lap}`,
    '        <Track>',
    ...trackpoints,
    '        </Track>',
    `        <Extensions><ns3:LX><ns3:AvgWatts>${summary.avgPower}</ns3:AvgWatts><ns3:MaxWatts>${summary.maxPower}</ns3:MaxWatts></ns3:LX></Extensions>`,
    '      </Lap>',
    `      <Notes>${escapeXml(ride.name || 'Open Ride')}</Notes>`,
    '    </Activity>',
    '  </Activities>',
    '</TrainingCenterDatabase>',
    '',
  ].join('\n');
}

// ─── FIT ─────────────────────────────────────────────────────────────────────

// Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z)
const FIT_EPOCH_OFFSET = 631065600;
const FIT_PROFILE_VERSION = 2132;

const BASE_TYPES = {
  enum:    { id: 0x00, size: 1, invalid: 0xFF,       min: 0,           max: 0xFE },
  uint8:   { id: 0x02, size: 1, invalid: 0xFF,       min: 0,           max: 0xFE },
  uint16:  { id: 0x84, size: 2, invalid: 0xFFFF,     min: 0,           max: 0xFFFE },
  sint32:  { id: 0x85, size: 4, invalid: 0x7FFFFFFF, min: -0x7FFFFFFF, max: 0x7FFFFFFE },
  uint32:  { id: 0x86, size: 4, invalid: 0xFFFFFFFF, min: 0,           max: 0xFFFFFFFE },
  uint32z: { id: 0x8C, size: 4, invalid: 0,          min: 1,           max: 0xFFFFFFFF },
};

// FIT profile enums
const FILE_ACTIVITY = 4;
const MANUFACTURER_DEVELOPMENT = 255;
const SPORT_CYCLING = 2;
const SUB_SPORT_INDOOR_CYCLING = 6;
const SUB_SPORT_VIRTUAL_ACTIVITY = 58;
const EVENT_TIMER = 0;
const EVENT_SESSION = 8;
const EVENT_LAP = 9;
const EVENT_ACTIVITY = 26;
const EVENT_TYPE_START = 0;
const EVENT_TYPE_STOP = 1;
const EVENT_TYPE_STOP_ALL = 4;
const ACTIVITY_MANUAL = 0;

// Message definitions: global message number + [field number, base type]
const MESSAGES = {
  fileId: { global: 0, fields: { type: [0, 'enum'], manufacturer: [1, 'uint16'], product: [2, 'uint16'], serialNumber: [3, 'uint32z'], timeCreated: [4, 'uint32'] } },
  event: { global: 21, fields: { timestamp: [253, 'uint32'], event: [0, 'enum'], eventType: [1, 'enum'] } },
  record: {
    global: 20,
    fields: {
      timestamp: [253, 'uint32'], positionLat: [0, 'sint32'], positionLong: [1, 'sint32'], altitude: [2, 'uint16'],
      heartRate: [3, 'uint8'], cadence: [4, 'uint8'], distance: [5, 'uint32'], speed: [6, 'uint16'], power: [7, 'uint16'],
    },
  },
  lap: {
    global: 19,
    fields: {
      timestamp: [253, 'uint32'], event: [0, 'enum'], eventType: [1, 'enum'], startTime: [2, 'uint32'],
      totalElapsedTime: [7, 'uint32'], totalTimerTime: [8, 'uint32'], totalDistance: [9, 'uint32'], totalCalories: [11, 'uint16'],
      maxSpeed: [14, 'uint16'], avgHeartRate: [15, 'uint8'], maxHeartRate: [16, 'uint8'], avgCadence: [17, 'uint8'],
      avgPower: [19, 'uint16'], maxPower: [20, 'uint16'], totalAscent: [21, 'uint16'], sport: [25, 'enum'], subSport: [39, 'enum'],
    },
  },
  session: {
    global: 18,
    fields: {
      timestamp: [253, 'uint32'], event: [0, 'enum'], eventType: [1, 'enum'], startTime: [2, 'uint32'],
      sport: [5, 'enum'], subSport: [6, 'enum'], totalElapsedTime: [7, 'uint32'], totalTimerTime: [8, 'uint32'],
      totalDistance: [9, 'uint32'], totalCalories: [11, 'uint16'], maxSpeed: [15, 'uint16'], avgHeartRate: [16, 'uint8'],
      maxHeartRate: [17, 'uint8'], avgCadence: [18, 'uint8'], avgPower: [20, 'uint16'], maxPower: [21, 'uint16'],
      totalAscent: [22, 'uint16'], firstLapIndex: [25, 'uint16'], numLaps: [26, 'uint16'], normalizedPower: [34, 'uint16'],
      trainingStressScore: [35, 'uint16'], intensityFactor: [36, 'uint16'], thresholdPower: [45, 'uint16'],
    },
  },
  activity: {
    global: 34,
    fields: {
      timestamp: [253, 'uint32'], totalTimerTime: [0, 'uint32'], numSessions: [1, 'uint16'], type: [2, 'enum'],
      event: [3, 'enum'], eventType: [4, 'enum'], localTimestamp: [5, 'uint32'],
    },
  },
};

const CRC_TABLE = [
  0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
  0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
];

/** FIT CRC-16 over bytes[start, end). */
export function fitCrc(bytes, start = 0, end = bytes.length) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    const byte = bytes[i];
    let tmp = CRC_TABLE[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xF];
    tmp = CRC_TABLE[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xF];
  }
  return crc;
}

function createFitWriter() {
  const bytes = [];
  const scratch = new DataView(new ArrayBuffer(4));
  const definitions = new Map(); // local message type → field names

  function writeValue(value, type) {
    const base = BASE_TYPES[type];
    let v = base.invalid;
    if (value !== undefined && value !== null && Number.isFinite(value)) {
      v = Math.max(base.min, Math.min(base.max, Math.round(value)));
    }
    if (base.size === 1) bytes.push(v & 0xFF);
    else if (base.size === 2) {
      scratch.setUint16(0, v, true);
      bytes.push(scratch.getUint8(0), scratch.getUint8(1));
    } else {
      if (type === 'sint32') scratch.setInt32(0, v, true);
      else scratch.setUint32(0, v >>> 0, true);
      bytes.push(scratch.getUint8(0), scratch.getUint8(1), scratch.getUint8(2), scratch.getUint8(3));
    }
  }

  return {
    bytes,
    /** Write a definition message for the given fields of a message. */
    define(localType, messageName, fieldNames) {
      const message = MESSAGES[messageName];
      bytes.push(0x40 | localType, 0, 0); // header, reserved, little-endian
      bytes.push(message.global & 0xFF, (message.global >> 8) & 0xFF);
      bytes.push(fieldNames.length);
      for (const name of fieldNames) {
        const [num, type] = message.fields[name];
        bytes.push(num, BASE_TYPES[type].size, BASE_TYPES[type].id);
      }
      definitions.set(localType, { messageName, fieldNames });
    },
    /** Write a data message using the current definition of a local type. */
    write(localType, values) {
      const { messageName, fieldNames } = definitions.get(localType);
      const message = MESSAGES[messageName];
      bytes.push(localType & 0x0F);
      for (const name of fieldNames) writeValue(values[name], message.fields[name][1]);
    },
  };
}

const fitTime = ms => Math.round(ms / 1000) - FIT_EPOCH_OFFSET;
const semicircles = degrees => degrees * (2 ** 31 / 180);

/**
 * Build a FIT activity file.
 * @returns {Uint8Array}
 */
export function buildFit(ride) {
  const track = prepareTrack(ride);
  const summary = summarise(ride, track);
  const positions = hasPositions(track);
  const startMs = new Date(ride.startTime).getTime();
  const endMs = track.length ? track[track.length - 1].time : startMs;
  const subSport = positions ? SUB_SPORT_VIRTUAL_ACTIVITY : SUB_SPORT_INDOOR_CYCLING;
  const fit = createFitWriter();

  fit.define(0, 'fileId', ['type', 'manufacturer', 'product', 'serialNumber', 'timeCreated']);
  fit.write(0, {
    type: FILE_ACTIVITY,
    manufacturer: MANUFACTURER_DEVELOPMENT,
    product: 0,
    serialNumber: (ride.id % 0xFFFFFFFE) + 1,
    timeCreated: fitTime(startMs),
  });

  fit.define(1, 'event', ['timestamp', 'event', 'eventType']);
  fit.write(1, { timestamp: fitTime(startMs), event: EVENT_TIMER, eventType: EVENT_TYPE_START });

  const recordFields = ['timestamp', 'heartRate', 'cadence', 'distance', 'speed', 'power'];
  if (positions) recordFields.push('positionLat', 'positionLong');
  if (track.some(p => Number.isFinite(p.altitude))) recordFields.push('altitude');
  fit.define(2, 'record', recordFields);

  let prevTime = startMs;
  for (const p of track) {
    // A gap longer than a second is a pause: stop the timer, restart it
    if (p.time - prevTime > 1500) {
      fit.write(1, { timestamp: fitTime(prevTime), event: EVENT_TIMER, eventType: EVENT_TYPE_STOP_ALL });
      fit.write(1, { timestamp: fitTime(p.time - 1000), event: EVENT_TIMER, eventType: EVENT_TYPE_START });
    }
    fit.write(2, {
      timestamp: fitTime(p.time),
      heartRate: p.heartRate > 0 ? p.heartRate : undefined,
      cadence: p.cadence,
      distance: p.distance * 100,
      speed: p.speed * 1000,
      power: p.power,
      positionLat: positions ? semicircles(p.lat) : undefined,
      positionLong: positions ? semicircles(p.lng) : undefined,
      altitude: Number.isFinite(p.altitude) ? (p.altitude + 500) * 5 : undefined,
    });
    prevTime = p.time;
  }

  fit.write(1, { timestamp: fitTime(endMs), event: EVENT_TIMER, eventType: EVENT_TYPE_STOP_ALL });

  const totals = {
    timestamp: fitTime(endMs),
    eventType: EVENT_TYPE_STOP,
    startTime: fitTime(startMs),
    totalElapsedTime: (endMs - startMs),          // ms (scale 1000)
    totalTimerTime: summary.duration * 1000,       // ms (scale 1000)
    totalDistance: summary.distance * 100,         // cm (scale 100)
    totalCalories: summary.calories,
    maxSpeed: summary.maxSpeed * 1000,             // mm/s (scale 1000)
    avgHeartRate: summary.avgHeartRate || undefined,
    maxHeartRate: summary.maxHeartRate || undefined,
    avgCadence: summary.avgCadence,
    avgPower: summary.avgPower,
    maxPower: summary.maxPower,
    totalAscent: positions || summary.ascent > 0 ? summary.ascent : undefined,
    sport: SPORT_CYCLING,
    subSport,
  };

  const lapFields = Object.keys(MESSAGES.lap.fields);
  fit.define(3, 'lap', lapFields);
  fit.write(3, { ...totals, event: EVENT_LAP });

  const sessionFields = Object.keys(MESSAGES.session.fields);
  fit.define(4, 'session', sessionFields);
  fit.write(4, {
    ...totals,
    event: EVENT_SESSION,
    firstLapIndex: 0,
    numLaps: 1,
    normalizedPower: summary.normalizedPower,
    trainingStressScore: ride.ftp > 0 ? summary.tss * 10 : undefined,                   // scale 10
    intensityFactor: ride.ftp > 0 ? parseFloat(summary.intensityFactor) * 1000 : undefined, // scale 1000
    thresholdPower: ride.ftp > 0 ? ride.ftp : undefined,
  });

  fit.define(5, 'activity', ['timestamp', 'totalTimerTime', 'numSessions', 'type', 'event', 'eventType', 'localTimestamp']);
  fit.write(5, {
    timestamp: fitTime(endMs),
    totalTimerTime: summary.duration * 1000,
    numSessions: 1,
    type: ACTIVITY_MANUAL,
    event: EVENT_ACTIVITY,
    eventType: EVENT_TYPE_STOP,
    localTimestamp: fitTime(endMs) - new Date(endMs).getTimezoneOffset() * 60,
  });

  // Header (14 bytes) + data + file CRC
  const dataSize = fit.bytes.length;
  const file = new Uint8Array(14 + dataSize + 2);
  const view = new DataView(file.buffer);
  view.setUint8(0, 14);
  view.setUint8(1, 0x10); // protocol version 1.0
  view.setUint16(2, FIT_PROFILE_VERSION, true);
  view.setUint32(4, dataSize, true);
  file.set([0x2E, 0x46, 0x49, 0x54], 8); // ".FIT"
  view.setUint16(12, fitCrc(file, 0, 12), true);
  file.set(fit.bytes, 14);
  view.setUint16(14 + dataSize, fitCrc(file, 0, 14 + dataSize), true);
  return file;
}

// ─── Download ────────────────────────────────────────────────────────────────

/**
 * Trigger a browser download of the ride as 'fit' or 'tcx'.
 */
export function downloadRide(ride, format) {
  const isFit = format === 'fit';
  const content = isFit ? buildFit(ride) : buildTcx(ride);
  const blob = new Blob([content], {
    type: isFit ? 'application/vnd.ant.fit' : 'application/vnd.garmin.tcx+xml',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = rideFileName(ride, isFit ? 'fit' : 'tcx');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
