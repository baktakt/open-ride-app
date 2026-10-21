/**
 * Ride metrics — pure functions over a 1 Hz sample stream.
 *
 * A sample is { power, cadence, heartRate, speed, distance } where distance is
 * the trainer's cumulative distance in metres (may start at any value).
 *
 * Conventions (same as Garmin / TrainingPeaks defaults):
 *   - Average power includes zeros (coasting counts as 0 W).
 *   - Average cadence and heart rate exclude zeros.
 *   - Normalized Power uses a 30 s rolling average raised to the 4th power.
 */

const NP_WINDOW_SECONDS = 30;

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Normalized Power for a 1 Hz power series.
 * Rides shorter than the 30 s window fall back to plain average power.
 */
export function normalizedPower(powers) {
  if (powers.length === 0) return 0;
  if (powers.length < NP_WINDOW_SECONDS) return mean(powers);

  let windowSum = 0;
  let fourthPowerSum = 0;
  let count = 0;
  for (let i = 0; i < powers.length; i++) {
    windowSum += powers[i];
    if (i >= NP_WINDOW_SECONDS) windowSum -= powers[i - NP_WINDOW_SECONDS];
    if (i >= NP_WINDOW_SECONDS - 1) {
      const rolling = windowSum / NP_WINDOW_SECONDS;
      fourthPowerSum += rolling ** 4;
      count += 1;
    }
  }
  return Math.pow(fourthPowerSum / count, 0.25);
}

/**
 * Training Stress Score: (seconds × NP × IF) / (FTP × 3600) × 100.
 */
export function trainingStressScore(durationSeconds, np, ftp) {
  if (!ftp || ftp <= 0) return 0;
  const intensity = np / ftp;
  return (durationSeconds * np * intensity) / (ftp * 3600) * 100;
}

/**
 * Distance covered within the sample stream, robust to a trainer whose
 * cumulative distance resets mid-ride (e.g. after a reconnect).
 */
export function distanceCovered(samples) {
  let total = 0;
  let prev = null;
  for (const s of samples) {
    const d = s.distance;
    if (typeof d !== 'number' || !Number.isFinite(d)) continue;
    if (prev !== null && d >= prev) total += d - prev;
    prev = d;
  }
  return total;
}

/**
 * Summarise a ride from its 1 Hz samples.
 * @param {Array<object>} samples
 * @param {number} ftp
 */
export function computeRideMetrics(samples, ftp) {
  const duration = samples.length;
  const powers = samples.map(s => Math.max(0, s.power || 0));
  const cadences = samples.map(s => s.cadence || 0).filter(c => c > 0);
  const heartRates = samples.map(s => s.heartRate || 0).filter(hr => hr > 0);

  const avgPower = mean(powers);
  const np = normalizedPower(powers);
  const work = powers.reduce((sum, p) => sum + p, 0); // joules (1 s per sample)
  const intensityFactor = ftp > 0 ? np / ftp : 0;

  return {
    duration,
    distance: Math.round(distanceCovered(samples)),
    avgPower: Math.round(avgPower),
    maxPower: Math.round(powers.length ? Math.max(...powers) : 0),
    normalizedPower: Math.round(np),
    avgCadence: Math.round(mean(cadences)),
    avgHeartRate: Math.round(mean(heartRates)),
    maxHeartRate: heartRates.length ? Math.max(...heartRates) : 0,
    kilojoules: Math.round(work / 1000),
    // 1 kJ mechanical ≈ 1 kcal metabolic (≈24% gross efficiency) — the convention
    // used by Garmin, Wahoo and TrainingPeaks
    calories: Math.round(work / 1000),
    intensityFactor: ftp > 0 ? intensityFactor.toFixed(2) : '--',
    tss: Math.round(trainingStressScore(duration, np, ftp)),
    ftp,
  };
}

/**
 * Estimate NP / IF / TSS for a planned workout from its per-second target
 * profile expressed as fractions of FTP (e.g. 0.75 = 75 % FTP).
 */
export function estimatePlannedLoad(ftpFractions) {
  const np = normalizedPower(ftpFractions);
  return {
    intensityFactor: np,
    tss: Math.round(trainingStressScore(ftpFractions.length, np, 1)),
  };
}
