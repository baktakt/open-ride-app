/**
 * Steady-state road cycling physics.
 *
 *   P = v · (m·g·(sin θ + Crr·cos θ)) + ½·ρ·CdA·v³
 *
 * Used by the emulator for grade simulation; also suitable for deriving a
 * virtual speed from power on simulated routes.
 */

const G = 9.80665;

export const DEFAULT_RIDER = Object.freeze({
  mass: 85,     // rider + bike, kg
  crr: 0.004,   // rolling resistance coefficient
  cda: 0.32,    // drag area, m² (hoods)
  rho: 1.225,   // air density, kg/m³
});

const MAX_SPEED_MS = 40;

/**
 * Speed (m/s) at which the given power balances gravity, rolling resistance
 * and aerodynamic drag on the given grade.
 * @param {number} power         watts
 * @param {number} gradePercent  e.g. 5 = 5 % uphill
 * @param {object} [rider]       { mass, crr, cda, rho }
 */
export function speedFromPower(power, gradePercent, rider = DEFAULT_RIDER) {
  const { mass, crr, cda, rho } = { ...DEFAULT_RIDER, ...rider };
  const theta = Math.atan(gradePercent / 100);
  const resistiveForce = mass * G * (Math.sin(theta) + crr * Math.cos(theta));
  const powerAt = v => v * resistiveForce + 0.5 * rho * cda * v * v * v;

  const p = Math.max(0, power);
  if (p === 0 && resistiveForce >= 0) return 0;

  // powerAt() is increasing beyond its minimum, so bisect on [low, high]
  let low = 0;
  let high = MAX_SPEED_MS;
  if (powerAt(high) < p) return high;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (powerAt(mid) < p) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
