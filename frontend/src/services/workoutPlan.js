/**
 * Workout execution plan — turns parsed .orw elements into a flat list of
 * timed segments the WorkoutPage can execute second by second.
 *
 * Segment shape:
 *   { name, type, duration, mode, startPower, endPower, targetPower,
 *     startFtp, endFtp, targetCadence, resistance }
 *
 *   mode 'erg'        → trainer holds a power target, interpolated from
 *                       startPower to endPower across the segment (ramps)
 *   mode 'resistance' → no power target; trainer set to a fixed resistance
 *                       (FreeRide, MaxEffort) so the rider controls the effort
 */

// Resistance levels (0–100 %) for segments without a power target
export const FREE_RIDE_RESISTANCE = 25;
export const MAX_EFFORT_RESISTANCE = 50;

// How long a coaching message stays on screen
export const TEXT_EVENT_DISPLAY_SECONDS = 10;

/**
 * Start and end intensity (fraction of FTP) for ramp-type elements.
 *
 * Files disagree on attribute order for Cooldown: Zwift writes
 * PowerLow = start / PowerHigh = end (e.g. Low 0.75, High 0.25), while the
 * Open Ride library writes PowerHigh > PowerLow. A cooldown always ramps down
 * and a warmup always ramps up, so their direction is taken from the element
 * type. A plain Ramp is taken literally (PowerLow → PowerHigh), which also
 * allows ramping down.
 */
export function rampEndpoints(element) {
  const low = element.powerLow ?? 0;
  const high = element.powerHigh ?? 0;
  if (element.type === 'Warmup') return [Math.min(low, high), Math.max(low, high)];
  if (element.type === 'Cooldown') return [Math.max(low, high), Math.min(low, high)];
  return [low, high];
}

function ergSegment(name, type, duration, startFtp, endFtp, cadence, ftp) {
  return {
    name,
    type,
    duration,
    mode: 'erg',
    startFtp,
    endFtp,
    startPower: Math.round(startFtp * ftp),
    endPower: Math.round(endFtp * ftp),
    targetPower: Math.round(startFtp * ftp),
    targetCadence: cadence,
  };
}

function resistanceSegment(name, type, duration, resistance, cadence) {
  return {
    name,
    type,
    duration,
    mode: 'resistance',
    resistance,
    startFtp: 0,
    endFtp: 0,
    startPower: 0,
    endPower: 0,
    targetPower: 0,
    targetCadence: cadence,
  };
}

/**
 * Build the execution plan for a workout.
 * @param {Array<object>} elements  parsed workout elements
 * @param {number} ftp              rider FTP in watts
 */
export function buildExecutionPlan(elements, ftp) {
  if (!elements) return [];
  const plan = [];

  for (const element of elements) {
    const cadence = element.cadence || 90;
    switch (element.type) {
      case 'SteadyState':
        plan.push(ergSegment('Steady', 'SteadyState', element.duration, element.power, element.power, cadence, ftp));
        break;

      case 'Warmup':
      case 'Cooldown':
      case 'Ramp': {
        const [startFtp, endFtp] = rampEndpoints(element);
        plan.push(ergSegment(element.type, element.type, element.duration, startFtp, endFtp, cadence, ftp));
        break;
      }

      case 'IntervalsT':
        for (let i = 0; i < element.repeat; i++) {
          plan.push(ergSegment(
            `Interval ${i + 1} (ON)`, 'IntervalOn', element.onDuration,
            element.onPower, element.onPower, cadence, ftp
          ));
          plan.push(ergSegment(
            `Recovery ${i + 1}`, 'IntervalOff', element.offDuration,
            element.offPower, element.offPower, element.cadenceResting || 85, ftp
          ));
        }
        break;

      case 'FreeRide':
        plan.push(resistanceSegment('Free Ride', 'FreeRide', element.duration, FREE_RIDE_RESISTANCE, cadence));
        break;

      case 'MaxEffort':
        plan.push(resistanceSegment('Max Effort', 'MaxEffort', element.duration, MAX_EFFORT_RESISTANCE, element.cadence || 100));
        break;

      default:
        break;
    }
  }

  return plan.filter(segment => segment.duration > 0);
}

/**
 * Power target in watts at a point within a segment (linear across ramps).
 * Returns null for resistance-mode segments.
 */
export function targetPowerAt(segment, secondsIntoSegment) {
  if (!segment || segment.mode !== 'erg') return null;
  if (segment.duration <= 1 || segment.startPower === segment.endPower) return segment.startPower;
  const progress = Math.min(1, Math.max(0, secondsIntoSegment / (segment.duration - 1)));
  return Math.round(segment.startPower + (segment.endPower - segment.startPower) * progress);
}

function elementDuration(element) {
  if (element.type === 'IntervalsT') {
    return element.repeat * (element.onDuration + element.offDuration);
  }
  return element.duration || 0;
}

/**
 * Coaching messages placed on the absolute workout timeline.
 * Text event offsets are relative to their element's start. Interval sets
 * without their own messages get generated "Push!" / "Recover" cues.
 * @returns {Array<{ time: number, message: string }>} sorted by time
 */
export function buildTextEvents(elements) {
  if (!elements) return [];
  const events = [];
  let elementStart = 0;

  for (const element of elements) {
    const textEvents = element.textEvents || [];
    for (const event of textEvents) {
      if (event.message) {
        events.push({ time: elementStart + (event.timeoffset || 0), message: event.message });
      }
    }

    if (element.type === 'IntervalsT' && textEvents.length === 0) {
      let t = elementStart;
      for (let i = 0; i < element.repeat; i++) {
        events.push({ time: t, message: `Interval ${i + 1} of ${element.repeat} — push!` });
        t += element.onDuration;
        events.push({ time: t, message: `Recover` });
        t += element.offDuration;
      }
    }

    elementStart += elementDuration(element);
  }

  return events.sort((a, b) => a.time - b.time);
}

/**
 * The message to show at a given workout time, or null.
 */
export function activeTextEvent(events, elapsedSeconds) {
  let active = null;
  for (const event of events) {
    if (event.time > elapsedSeconds) break;
    active = event;
  }
  if (!active || elapsedSeconds - active.time >= TEXT_EVENT_DISPLAY_SECONDS) return null;
  return active;
}
