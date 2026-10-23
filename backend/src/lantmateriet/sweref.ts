/**
 * SWEREF 99 TM (EPSG:3006 — the horizontal part of Lantmäteriet's
 * EPSG:5845) forward projection.
 *
 * Transverse Mercator on the GRS 80 ellipsoid, central meridian 15° E,
 * scale 0.9996, false easting 500 000 m, computed with the Gauss–Krüger
 * series published by Lantmäteriet ("Gauss Krügers projektion" formulas:
 * conformal latitude, then the n-series for northing and easting).
 * Accurate to well under a millimetre across Sweden (checked against PROJ
 * in the tests).
 */

const DEG = Math.PI / 180;

// GRS 80 and the projection parameters
const SEMI_MAJOR = 6378137;
const FLATTENING = 1 / 298.257222101;
const CENTRAL_MERIDIAN = 15 * DEG;
const SCALE = 0.9996;
const FALSE_NORTHING = 0;
const FALSE_EASTING = 500000;

// Derived constants (computed once)
const E2 = FLATTENING * (2 - FLATTENING);             // first eccentricity squared
const N = FLATTENING / (2 - FLATTENING);              // third flattening
const RECTIFYING_RADIUS = (SEMI_MAJOR / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);

// Conformal latitude series coefficients (in powers of e²)
const CONFORMAL = [
  E2,
  (5 * E2 ** 2 - E2 ** 3) / 6,
  (104 * E2 ** 3 - 45 * E2 ** 4) / 120,
  (1237 * E2 ** 4) / 1260,
];

// Gauss–Krüger series coefficients β1..β4 (in powers of n)
const BETA = [
  N / 2 - (2 / 3) * N ** 2 + (5 / 16) * N ** 3 + (41 / 180) * N ** 4,
  (13 / 48) * N ** 2 - (3 / 5) * N ** 3 + (557 / 1440) * N ** 4,
  (61 / 240) * N ** 3 - (103 / 140) * N ** 4,
  (49561 / 161280) * N ** 4,
];

/** WGS84 / ETRS89 latitude and longitude (degrees) → SWEREF 99 TM [easting, northing] (metres). */
export function toSweref99tm(lat: number, lon: number): [number, number] {
  const phi = lat * DEG;
  const sin2 = Math.sin(phi) ** 2;

  // Conformal latitude
  const series = CONFORMAL[0] + sin2 * (CONFORMAL[1] + sin2 * (CONFORMAL[2] + sin2 * CONFORMAL[3]));
  const conformal = phi - Math.sin(phi) * Math.cos(phi) * series;

  // Spherical transverse Mercator coordinates on the conformal sphere
  const dLon = lon * DEG - CENTRAL_MERIDIAN;
  const xiPrime = Math.atan2(Math.tan(conformal), Math.cos(dLon));
  const etaPrime = Math.atanh(Math.cos(conformal) * Math.sin(dLon));

  // Krüger series corrections
  let xi = xiPrime;
  let eta = etaPrime;
  BETA.forEach((beta, k) => {
    const m = 2 * (k + 1);
    xi += beta * Math.sin(m * xiPrime) * Math.cosh(m * etaPrime);
    eta += beta * Math.cos(m * xiPrime) * Math.sinh(m * etaPrime);
  });

  const k = SCALE * RECTIFYING_RADIUS;
  return [FALSE_EASTING + k * eta, FALSE_NORTHING + k * xi];
}
