/**
 * Bluetooth LE characteristic parsers — pure functions over DataView so they
 * can be unit tested without a browser.
 *
 * Telemetry objects use the same field names as the ANT+ managers
 * (instantaneousPower, instantaneousCadence, speed, distance, heartRate,
 * elapsedTime). Fields a packet does not carry are left undefined.
 */

/**
 * Indoor Bike Data (0x2AD2) — FTMS §4.9.1.
 * Flags (uint16) followed by the present fields, in order:
 *   bit 0: More Data — Instantaneous Speed is ABSENT when set
 *   bit 1: Average Speed            uint16
 *   bit 2: Instantaneous Cadence    uint16, 0.5 rpm
 *   bit 3: Average Cadence          uint16
 *   bit 4: Total Distance           uint24, m
 *   bit 5: Resistance Level         sint16
 *   bit 6: Instantaneous Power      sint16, W
 *   bit 7: Average Power            sint16
 *   bit 8: Expended Energy          uint16 + uint16 + uint8
 *   bit 9: Heart Rate               uint8, bpm
 *  bit 10: Metabolic Equivalent     uint8
 *  bit 11: Elapsed Time             uint16, s
 *  bit 12: Remaining Time           uint16
 */
export function parseIndoorBikeData(dataView) {
  const t = {};
  if (dataView.byteLength < 2) return t;
  const flags = dataView.getUint16(0, true);
  let offset = 2;
  const has = (bytes) => offset + bytes <= dataView.byteLength;

  if (!(flags & 0x0001) && has(2)) {
    t.speed = dataView.getUint16(offset, true) * 0.01; // km/h
    offset += 2;
  }
  if (flags & 0x0002) offset += 2;
  if ((flags & 0x0004) && has(2)) {
    t.instantaneousCadence = dataView.getUint16(offset, true) * 0.5;
    offset += 2;
  }
  if (flags & 0x0008) offset += 2;
  if ((flags & 0x0010) && has(3)) {
    t.distance = dataView.getUint8(offset)
      | (dataView.getUint8(offset + 1) << 8)
      | (dataView.getUint8(offset + 2) << 16);
    offset += 3;
  }
  if (flags & 0x0020) offset += 2;
  if ((flags & 0x0040) && has(2)) {
    t.instantaneousPower = dataView.getInt16(offset, true);
    offset += 2;
  }
  if (flags & 0x0080) offset += 2;
  if (flags & 0x0100) offset += 5;
  if ((flags & 0x0200) && has(1)) {
    t.heartRate = dataView.getUint8(offset);
    offset += 1;
  }
  if (flags & 0x0400) offset += 1;
  if ((flags & 0x0800) && has(2)) {
    t.elapsedTime = dataView.getUint16(offset, true);
    offset += 2;
  }
  return t;
}

/**
 * Cycling Power Measurement (0x2A63) — CPS §3.2.
 * Flags (uint16), Instantaneous Power (sint16), then optional fields:
 *   bit 0: Pedal Power Balance      uint8
 *   bit 2: Accumulated Torque       uint16
 *   bit 4: Wheel Revolution Data    uint32 revs + uint16 event time
 *   bit 5: Crank Revolution Data    uint16 revs + uint16 event time (1/1024 s)
 * @returns {{ instantaneousPower: number, crank?: { revs: number, eventTime: number } }}
 */
export function parseCyclingPowerMeasurement(dataView) {
  if (dataView.byteLength < 4) return null;
  const flags = dataView.getUint16(0, true);
  const result = { instantaneousPower: dataView.getInt16(2, true) };

  let offset = 4;
  if (flags & 0x0001) offset += 1;
  if (flags & 0x0004) offset += 2;
  if (flags & 0x0010) offset += 6;
  if ((flags & 0x0020) && offset + 4 <= dataView.byteLength) {
    result.crank = {
      revs: dataView.getUint16(offset, true),
      eventTime: dataView.getUint16(offset + 2, true),
    };
  }
  return result;
}

// No new crank event for this long means the rider stopped pedalling
const CRANK_STOP_TIMEOUT_MS = 2500;
const MAX_PLAUSIBLE_CADENCE = 250;

/**
 * Derive cadence from successive cumulative crank revolution readings,
 * handling uint16 roll-over of both counters.
 *
 * @param {object|null} state  previous state returned by this function
 * @param {{ revs: number, eventTime: number }} crank
 * @param {number} now         ms timestamp of this notification
 * @returns {{ state: object, cadence: number|undefined }}
 *   cadence is undefined when this notification carries no new information
 */
export function updateCrankCadence(state, crank, now) {
  if (!state) {
    return { state: { ...crank, lastChange: now, cadence: 0 }, cadence: undefined };
  }

  const deltaRevs = (crank.revs - state.revs) & 0xFFFF;
  const deltaTime = (crank.eventTime - state.eventTime) & 0xFFFF; // 1/1024 s

  if (deltaRevs > 0 && deltaTime > 0) {
    const cadence = (deltaRevs * 60 * 1024) / deltaTime;
    const plausible = cadence <= MAX_PLAUSIBLE_CADENCE ? cadence : state.cadence;
    return { state: { ...crank, lastChange: now, cadence: plausible }, cadence: plausible };
  }

  if (now - state.lastChange > CRANK_STOP_TIMEOUT_MS) {
    return { state: { ...state, cadence: 0 }, cadence: 0 };
  }
  // Same event repeated (power meters re-send the last event): keep cadence
  return { state, cadence: state.cadence };
}

/**
 * Heart Rate Measurement (0x2A37) — HRS §3.1.
 * bit 0 of flags selects uint8 or uint16 heart rate.
 */
export function parseHeartRateMeasurement(dataView) {
  if (dataView.byteLength < 2) return undefined;
  const flags = dataView.getUint8(0);
  if (flags & 0x01) {
    return dataView.byteLength >= 3 ? dataView.getUint16(1, true) : undefined;
  }
  return dataView.getUint8(1);
}

/**
 * Encode an FTMS Set Target Resistance Level command (op 0x04).
 *
 * FTMS v1.0 §4.16.2.5 defines the parameter as UINT8 with 0.1 resolution.
 * Some trainers advertise a Supported Resistance Level Range (0x2AD6) beyond
 * 25.5; for those the value cannot fit a UINT8 and is sent as SINT16, which
 * is what such devices accept in practice.
 *
 * @param {number} percent  0–100 % of the trainer's resistance range
 * @param {{ min: number, max: number }} range  resistance level range (unitless)
 * @returns {{ buffer: ArrayBuffer, level: number }}
 */
export function encodeTargetResistance(percent, range) {
  const clamped = Math.max(0, Math.min(100, percent));
  const level = range.min + ((range.max - range.min) * clamped) / 100;
  const raw = Math.round(level * 10);

  if (raw >= 0 && raw <= 0xFF) {
    const buffer = new ArrayBuffer(2);
    const view = new DataView(buffer);
    view.setUint8(0, 0x04);
    view.setUint8(1, raw);
    return { buffer, level: raw / 10 };
  }

  const buffer = new ArrayBuffer(3);
  const view = new DataView(buffer);
  view.setUint8(0, 0x04);
  view.setInt16(1, raw, true);
  return { buffer, level: raw / 10 };
}

/**
 * Supported Resistance Level Range (0x2AD6): min sint16, max sint16,
 * increment uint16 — all with 0.1 resolution.
 */
export function parseResistanceRange(dataView) {
  if (dataView.byteLength < 4) return null;
  const min = dataView.getInt16(0, true) / 10;
  const max = dataView.getInt16(2, true) / 10;
  if (!(max > min)) return null;
  return { min, max };
}
