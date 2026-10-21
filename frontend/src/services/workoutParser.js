/**
 * Client-side .orw XML parser.
 *
 * Parses a workout XML string using the browser's built-in DOMParser and
 * returns an object with the same shape as the backend's
 * GET /api/workouts/:id response so WorkoutPage can use it directly.
 *
 * Custom workouts no longer go through the backend at all — this module
 * gives the frontend full self-sufficiency for AI-generated workouts.
 */

import { estimatePlannedLoad } from './rideMetrics.js';
import { rampEndpoints } from './workoutPlan.js';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getAttr(el, name) {
  const v = el.getAttribute(name);
  return v !== null ? parseFloat(v) : undefined;
}

function getIntAttr(el, name) {
  const v = el.getAttribute(name);
  return v !== null ? parseInt(v, 10) : undefined;
}

function parseTextEvents(el) {
  return Array.from(el.querySelectorAll('textevent')).map(te => ({
    timeoffset: parseInt(te.getAttribute('timeoffset') || '0', 10),
    message: te.getAttribute('message') || '',
  }));
}

function elementDuration(el) {
  if (el.type === 'IntervalsT') {
    return el.repeat * (el.onDuration + el.offDuration);
  }
  return el.duration || 0;
}

// Assumed intensity for segments without an explicit power target
const FREE_RIDE_FTP_FRACTION = 0.65;
const MAX_EFFORT_FTP_FRACTION = 1.2;

function generateChartProfile(elements, numBars = 20) {
  const total = elements.reduce((s, el) => s + elementDuration(el), 0);
  if (total === 0) return Array(numBars).fill(0.5);

  const bars = [];
  for (let i = 0; i < numBars; i++) {
    const t = ((i + 0.5) / numBars) * total;
    let elapsed = 0;
    let power = 0.5;

    for (const el of elements) {
      const dur = elementDuration(el);
      if (t >= elapsed && t < elapsed + dur) {
        const pos = t - elapsed;
        if (el.type === 'IntervalsT') {
          const cycle = el.onDuration + el.offDuration;
          power = (pos % cycle) < el.onDuration ? el.onPower : el.offPower;
        } else if (el.type === 'SteadyState') {
          power = el.power;
        } else if (el.type === 'Warmup' || el.type === 'Cooldown' || el.type === 'Ramp') {
          const frac = dur > 0 ? pos / dur : 0;
          const [start, end] = rampEndpoints(el);
          power = start + frac * (end - start);
        } else if (el.type === 'MaxEffort') {
          power = MAX_EFFORT_FTP_FRACTION;
        } else {
          power = 0.5;
        }
        break;
      }
      elapsed += dur;
    }
    bars.push(power);
  }
  return bars;
}

/**
 * Per-second planned intensity (fractions of FTP), used for load estimates.
 */
function ftpProfile(elements) {
  const profile = [];
  const pushLinear = (duration, from, to) => {
    for (let t = 0; t < duration; t++) {
      profile.push(from + (to - from) * (duration > 1 ? t / (duration - 1) : 0));
    }
  };
  for (const el of elements) {
    if (el.type === 'IntervalsT') {
      for (let r = 0; r < el.repeat; r++) {
        pushLinear(el.onDuration, el.onPower, el.onPower);
        pushLinear(el.offDuration, el.offPower, el.offPower);
      }
    } else if (el.type === 'SteadyState') {
      pushLinear(el.duration, el.power, el.power);
    } else if (el.type === 'Warmup' || el.type === 'Cooldown' || el.type === 'Ramp') {
      pushLinear(el.duration, ...rampEndpoints(el));
    } else if (el.type === 'MaxEffort') {
      pushLinear(el.duration, MAX_EFFORT_FTP_FRACTION, MAX_EFFORT_FTP_FRACTION);
    } else {
      pushLinear(el.duration || 0, FREE_RIDE_FTP_FRACTION, FREE_RIDE_FTP_FRACTION);
    }
  }
  return profile;
}

function estimateTSS(elements) {
  return estimatePlannedLoad(ftpProfile(elements)).tss;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── ID generation ────────────────────────────────────────────────────────────

/**
 * Generate a stable, URL-safe workout id from a display name.
 * Format: custom-<slug>-<timestamp>
 */
export function generateCustomId(name) {
  const slug = (name || 'workout')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
  return `custom-${slug}-${Date.now()}`;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse an .orw XML string and return a full workout object.
 *
 * The returned shape matches the backend's /api/workouts/:id response so
 * WorkoutPage can consume it without modification.
 *
 * @param {string} xml  Raw .orw XML
 * @param {string} [id] Pre-assigned id (generated if omitted)
 * @returns {{ id, name, author, description, sportType, category, subcategory,
 *             tags, totalDuration, durationFormatted, elements, chartProfile,
 *             estimatedTSS }}
 */
export function parseOrwXml(xml, id) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid workout XML: ' + (parseError.textContent || 'parse error'));
  }

  const getText = (selector) =>
    doc.querySelector(selector)?.textContent?.trim() || '';

  const name = getText('name') || 'Custom Workout';
  const author = getText('author') || 'AI Generated';
  const description = getText('description') || '';
  const sportType = getText('sportType') || 'bike';
  const category = getText('category') || 'My Workouts';
  const subcategory = getText('subcategory') || '';
  const tags = Array.from(doc.querySelectorAll('tags tag'))
    .map(t => t.getAttribute('name') || '')
    .filter(Boolean);

  const workoutEl = doc.querySelector('workout');
  const elements = [];

  if (workoutEl) {
    for (const node of workoutEl.children) {
      const type = node.tagName;
      const textEvents = parseTextEvents(node);
      const optCadence = getAttr(node, 'Cadence');

      switch (type) {
        case 'Warmup':
        case 'Cooldown':
          elements.push({
            type,
            duration: getAttr(node, 'Duration') || 0,
            powerLow: getAttr(node, 'PowerLow') || 0,
            powerHigh: getAttr(node, 'PowerHigh') || 0,
            ...(optCadence !== undefined && { cadence: optCadence }),
            textEvents,
          });
          break;

        case 'SteadyState':
          elements.push({
            type: 'SteadyState',
            duration: getAttr(node, 'Duration') || 0,
            power: getAttr(node, 'Power') || 0,
            ...(optCadence !== undefined && { cadence: optCadence }),
            textEvents,
          });
          break;

        case 'Ramp':
          elements.push({
            type: 'Ramp',
            duration: getAttr(node, 'Duration') || 0,
            powerLow: getAttr(node, 'PowerLow') || 0,
            powerHigh: getAttr(node, 'PowerHigh') || 0,
            ...(optCadence !== undefined && { cadence: optCadence }),
            textEvents,
          });
          break;

        case 'IntervalsT': {
          const cadenceResting = getAttr(node, 'CadenceResting');
          elements.push({
            type: 'IntervalsT',
            repeat: getIntAttr(node, 'Repeat') || 1,
            onDuration: getAttr(node, 'OnDuration') || 0,
            offDuration: getAttr(node, 'OffDuration') || 0,
            onPower: getAttr(node, 'OnPower') || 0,
            offPower: getAttr(node, 'OffPower') || 0,
            ...(optCadence !== undefined && { cadence: optCadence }),
            ...(cadenceResting !== undefined && { cadenceResting }),
            textEvents,
          });
          break;
        }

        case 'FreeRide':
          elements.push({
            type: 'FreeRide',
            duration: getAttr(node, 'Duration') || 0,
            ...(optCadence !== undefined && { cadence: optCadence }),
            textEvents,
          });
          break;

        case 'MaxEffort':
          elements.push({
            type: 'MaxEffort',
            duration: getAttr(node, 'Duration') || 0,
            ...(optCadence !== undefined && { cadence: optCadence }),
            textEvents,
          });
          break;

        default:
          break;
      }
    }
  }

  const totalDuration = elements.reduce((s, el) => s + elementDuration(el), 0);
  const chartProfile = generateChartProfile(elements);
  const estimatedTSS = estimateTSS(elements);
  const resolvedId = id || generateCustomId(name);

  return {
    id: resolvedId,
    name,
    author,
    description,
    sportType,
    category,
    subcategory,
    tags,
    totalDuration,
    durationFormatted: formatDuration(totalDuration),
    elements,
    chartProfile,
    estimatedTSS,
  };
}
