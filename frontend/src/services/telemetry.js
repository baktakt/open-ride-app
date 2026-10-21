/**
 * Telemetry normalisation shared by all trainer managers.
 */

export const EMPTY_TELEMETRY = Object.freeze({
  power: 0, cadence: 0, speed: 0, heartRate: 0, distance: 0, elapsedTime: 0
});

// Manager telemetry field → context field. Managers may send partial updates
// (FTMS "More Data" packets, FE-C pages 0x10 / 0x19, CPS without speed), so
// absent fields keep their last value instead of dropping to 0.
const TELEMETRY_FIELDS = {
  power:       'instantaneousPower',
  cadence:     'instantaneousCadence',
  speed:       'speed',
  heartRate:   'heartRate',
  distance:    'distance',
  elapsedTime: 'elapsedTime',
};

// Instantaneous fields not refreshed within this window are treated as 0
// (e.g. a sensor that stopped reporting). Cumulative fields never go stale.
const STALE_AFTER_MS = 5000;
const CUMULATIVE_FIELDS = new Set(['distance', 'elapsedTime']);

/**
 * Merge a partial manager telemetry message into the previous context state.
 */
export function mergeTelemetry(prev, data, lastSeen, now) {
  const next = { ...prev };
  for (const [field, source] of Object.entries(TELEMETRY_FIELDS)) {
    const value = data[source];
    if (typeof value === 'number' && Number.isFinite(value)) {
      next[field] = value;
      lastSeen[field] = now;
    } else if (!CUMULATIVE_FIELDS.has(field) && now - (lastSeen[field] ?? 0) > STALE_AFTER_MS) {
      next[field] = 0;
    }
  }
  return next;
}
