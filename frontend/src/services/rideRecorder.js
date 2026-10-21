/**
 * Ride recorder — turns live telemetry into a 1 Hz sample stream timed by the
 * monotonic clock rather than by counting setInterval callbacks.
 *
 * Browsers throttle timers in background tabs (Chrome can drop to one wake-up
 * per minute), so counting ticks makes a workout run slow. Instead, every
 * tick() measures real elapsed time and back-fills one sample per whole second
 * that has passed, using the most recent telemetry.
 *
 * Usage:
 *   const recorder = createRideRecorder();
 *   recorder.start();
 *   setInterval(() => recorder.tick(telemetryRef.current), 250);
 *   recorder.elapsedSeconds   // whole seconds of active (unpaused) riding
 *   recorder.samples          // [{ t, timestamp, power, cadence, heartRate, speed, distance, ... }]
 *
 * `t` is seconds of active riding; `timestamp` is the wall-clock time (ms)
 * at which that second completed, so pauses appear as gaps between samples.
 */

const MAX_BACKFILL_SECONDS = 6 * 3600;

export function createRideRecorder({ now = () => performance.now(), wallNow = () => Date.now() } = {}) {
  let samples = [];
  let startedAt = null;
  let activeMs = 0;
  let lastTs = null;
  let running = false;
  let paused = false;

  function accumulate() {
    const ts = now();
    if (lastTs !== null) activeMs += Math.max(0, ts - lastTs);
    lastTs = ts;
  }

  return {
    get samples() { return samples; },
    get elapsedSeconds() { return samples.length; },
    get isRunning() { return running; },
    get isPaused() { return paused; },
    /** Wall-clock time (ms) the ride started */
    get startedAt() { return startedAt; },

    start() {
      samples = [];
      activeMs = 0;
      lastTs = now();
      startedAt = wallNow();
      running = true;
      paused = false;
    },

    pause() {
      if (!running || paused) return;
      accumulate();
      paused = true;
    },

    resume() {
      if (!running || !paused) return;
      lastTs = now();
      paused = false;
    },

    stop() {
      if (running && !paused) accumulate();
      running = false;
    },

    /**
     * Advance the clock and record any whole seconds that have elapsed.
     * @param {object} telemetry  latest { power, cadence, heartRate, speed, distance }
     * @param {object} [extra]    extra fields stored on each new sample (e.g. target power)
     * @returns {number} number of samples added
     */
    tick(telemetry, extra) {
      if (!running || paused) return 0;
      accumulate();
      const due = Math.min(Math.floor(activeMs / 1000), MAX_BACKFILL_SECONDS);
      const wall = wallNow();
      let added = 0;
      while (samples.length < due) {
        const t = samples.length + 1;
        samples.push({
          t,
          // when this second of riding completed (back-filled seconds included)
          timestamp: Math.round(wall - (activeMs - t * 1000)),
          power: telemetry?.power || 0,
          cadence: telemetry?.cadence || 0,
          heartRate: telemetry?.heartRate || 0,
          speed: telemetry?.speed || 0,
          distance: telemetry?.distance,
          ...extra,
        });
        added += 1;
      }
      return added;
    },
  };
}
