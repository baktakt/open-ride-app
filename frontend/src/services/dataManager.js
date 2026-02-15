/**
 * Data Manager
 *
 * Two responsibilities:
 *  1. localStorage CRUD for custom (AI-generated) workouts — these are the
 *     source of truth. The backend .orw files are a derived cache that we
 *     can re-create from localStorage after a server restart.
 *  2. Export / Import of all Open Ride user data as a portable JSON file.
 *
 * Custom workout schema stored in localStorage under CUSTOM_WORKOUTS_KEY:
 *   Array of { id, name, description, xml, totalDuration, chartProfile, tags, createdAt }
 *
 * NOTE: The API key is intentionally excluded from the export to avoid
 * accidental key exposure if the export file is shared.
 */

export const CUSTOM_WORKOUTS_KEY = 'openride_custom_workouts';
const WORKOUTS_CACHE_KEY = 'openride_cached_workouts';
const WORKOUTS_CACHE_TS_KEY = 'openride_cached_workouts_at';
const WORKOUT_CACHE_PREFIX = 'openride_cached_workout_';

// All keys that belong to Open Ride (used for export/import)
const ALL_KEYS = [
  'openride_settings',
  'openride_workout_history',
  'openride_training_program',
  CUSTOM_WORKOUTS_KEY,
  'openride_use_emulator',
  'openride_connection_type',
  'openride_was_connected',
];

// Exported schema version — bump if the format ever changes
const EXPORT_VERSION = 1;

// ─── Custom workout localStorage CRUD ────────────────────────────────────────

export function loadCustomWorkouts() {
  try {
    const raw = localStorage.getItem(CUSTOM_WORKOUTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

function persistCustomWorkouts(list) {
  localStorage.setItem(CUSTOM_WORKOUTS_KEY, JSON.stringify(list));
}

/**
 * Persist a custom workout to localStorage.
 * workoutData must include at minimum: { id, name, xml }
 */
export function saveCustomWorkoutLocally(workoutData) {
  const list = loadCustomWorkouts();
  const idx = list.findIndex(w => w.id === workoutData.id);
  const entry = {
    ...workoutData,
    createdAt: workoutData.createdAt || new Date().toISOString(),
  };
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.unshift(entry); // newest first
  }
  persistCustomWorkouts(list);
}

export function removeCustomWorkoutLocally(id) {
  const list = loadCustomWorkouts().filter(w => w.id !== id);
  persistCustomWorkouts(list);
}

/**
 * Rename a custom workout in localStorage.
 * Updates both the stored name and the <name> tag inside the raw XML.
 */
export function renameCustomWorkoutLocally(id, newName) {
  const list = loadCustomWorkouts();
  const idx = list.findIndex(w => w.id === id);
  if (idx < 0) return;
  list[idx].name = newName;
  if (list[idx].xml) {
    list[idx].xml = list[idx].xml.replace(
      /<name>[^<]*<\/name>/,
      `<name>${newName}</name>`
    );
  }
  persistCustomWorkouts(list);
}

// ─── Cached backend workouts (for offline use) ──────────────────────────────

export function loadCachedWorkouts() {
  try {
    const raw = localStorage.getItem(WORKOUTS_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

export function loadCachedWorkoutsTimestamp() {
  return localStorage.getItem(WORKOUTS_CACHE_TS_KEY);
}

export function saveCachedWorkouts(list) {
  try {
    localStorage.setItem(WORKOUTS_CACHE_KEY, JSON.stringify(list || []));
    localStorage.setItem(WORKOUTS_CACHE_TS_KEY, new Date().toISOString());
  } catch (_) {}
}

export function loadCachedWorkout(id) {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(`${WORKOUT_CACHE_PREFIX}${id}`);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

export function saveCachedWorkout(workout) {
  if (!workout || !workout.id) return;
  try {
    localStorage.setItem(`${WORKOUT_CACHE_PREFIX}${workout.id}`, JSON.stringify(workout));
  } catch (_) {}
}

// ─── Export / Import ──────────────────────────────────────────────────────────

/**
 * Build a JSON export object of all user data.
 * The AI API key is always excluded.
 */
export function buildExportPayload() {
  const payload = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'Open Ride',
    data: {},
  };

  for (const key of ALL_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        payload.data[key] = JSON.parse(raw);
      }
    } catch (_) {
      // Skip unparseable entries
    }
  }

  // Scrub API key — never include it in the export
  if (payload.data['openride_ai_settings']) {
    payload.data['openride_ai_settings'] = {
      ...payload.data['openride_ai_settings'],
      apiKey: '',
    };
  }

  return payload;
}

/**
 * Trigger a browser download of the export JSON.
 */
export function downloadExport() {
  const payload = buildExportPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `open-ride-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import data from a parsed export payload.
 * Returns a summary { imported: string[], skipped: string[], warnings: string[] }
 */
export function applyImport(payload) {
  const result = { imported: [], skipped: [], warnings: [] };

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid backup file format');
  }
  if (payload.version !== EXPORT_VERSION) {
    result.warnings.push(`Backup version ${payload.version} may not be fully compatible`);
  }
  if (!payload.data || typeof payload.data !== 'object') {
    throw new Error('Backup file contains no data');
  }

  for (const key of ALL_KEYS) {
    if (!(key in payload.data)) {
      result.skipped.push(key);
      continue;
    }
    try {
      localStorage.setItem(key, JSON.stringify(payload.data[key]));
      result.imported.push(key);
    } catch (err) {
      result.warnings.push(`Failed to restore ${key}: ${err.message}`);
    }
  }

  // Don't touch the API key — user must re-enter it
  result.warnings.push('API key was not restored — please re-enter it in Settings.');

  return result;
}

/**
 * Parse a File object and apply the import.
 */
export async function importFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const payload = JSON.parse(e.target.result);
        const result = applyImport(payload);
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse backup file: ${err.message}`));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
