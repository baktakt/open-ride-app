/**
 * AI Workout Generator Service
 *
 * Calls an LLM API (OpenAI or Anthropic) directly from the browser using
 * the user's own API key. No key is ever sent to Open Ride servers.
 *
 * localStorage key: openride_ai_settings
 *   { provider: 'openai' | 'anthropic', apiKey: string }
 */

import { saveCustomWorkoutLocally, removeCustomWorkoutLocally, renameCustomWorkoutLocally } from './dataManager.js';
import { parseOrwXml } from './workoutParser.js';

const AI_SETTINGS_KEY = 'openride_ai_settings';

export function loadAiSettings() {
  try {
    const stored = localStorage.getItem(AI_SETTINGS_KEY);
    if (stored) return JSON.parse(stored);
  } catch (_) {}
  return { provider: 'openai', apiKey: '' };
}

export function saveAiSettings(settings) {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
}

export function hasAiKey() {
  const { apiKey } = loadAiSettings();
  return typeof apiKey === 'string' && apiKey.trim().length > 0;
}

// Example .orw snippet provided to the LLM so it understands the format
const ORW_FORMAT_EXAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <name>Example Workout</name>
  <author>AI Generated</author>
  <description>A sample workout description.</description>
  <sportType>bike</sportType>
  <category>My Workouts</category>
  <subcategory>AI Generated</subcategory>
  <tags>
    <tag name="Custom"/>
  </tags>
  <workout>
    <Warmup Duration="300" PowerLow="0.40" PowerHigh="0.65" Cadence="90">
      <textevent timeoffset="0" message="Let's get warmed up!"/>
      <textevent timeoffset="150" message="Keep it easy and spin the legs."/>
    </Warmup>
    <SteadyState Duration="600" Power="0.75" Cadence="90">
      <textevent timeoffset="0" message="Settle into a steady tempo."/>
      <textevent timeoffset="300" message="Halfway through this block - great work!"/>
    </SteadyState>
    <IntervalsT Repeat="4" OnDuration="60" OffDuration="60" OnPower="1.05" OffPower="0.55" Cadence="95" CadenceResting="85">
      <textevent timeoffset="0" message="GO! Push hard for 60 seconds!"/>
      <textevent timeoffset="60" message="Recover - breathe and reset."/>
    </IntervalsT>
    <Cooldown Duration="300" PowerHigh="0.55" PowerLow="0.35" Cadence="80">
      <textevent timeoffset="0" message="Time to cool down. Great effort today!"/>
    </Cooldown>
  </workout>
</workout_file>`;

function buildSystemPrompt() {
  return `You are an expert cycling coach and structured workout designer for indoor cycling.
Your job is to generate a single complete workout in the .orw XML format.

STRICT RULES:
1. Output ONLY the raw XML. No markdown, no code fences, no explanations before or after.
2. Start the output with exactly: <?xml version="1.0" encoding="UTF-8"?>
3. All power values are fractions of FTP (e.g. 0.50 = 50% FTP, 1.00 = 100% FTP, 1.20 = 120% FTP).
4. Duration values are always in seconds (e.g. 300 = 5 minutes, 3600 = 60 minutes).
5. DURATION IS CRITICAL: Before writing the XML, mentally sum all segment durations. For IntervalsT the contribution is Repeat × (OnDuration + OffDuration). The grand total MUST equal the requested seconds (±20 seconds). If it doesn't match, adjust the last SteadyState or Cooldown segment to make it exact.
6. category must be exactly "My Workouts".
7. author must be exactly "AI Generated".
8. subcategory must be exactly "AI Generated".
9. Always include a proper Warmup at the start and a Cooldown at the end.
10. Add motivational textevent messages spread throughout each segment.
11. Cadence values are optional but helpful (typical range 75–110 rpm).
12. For IntervalsT: OnPower is the hard effort, OffPower is the recovery. Both Repeat and durations must be integers.
13. Power ceilings: MaxEffort = 1.50, sprints up to 1.60. Do not exceed 1.60.

SEGMENT TYPES AVAILABLE:
- Warmup: Duration PowerLow PowerHigh [Cadence]
- Cooldown: Duration PowerHigh PowerLow [Cadence]  (note: PowerHigh > PowerLow for ramp down)
- SteadyState: Duration Power [Cadence]
- Ramp: Duration PowerLow PowerHigh [Cadence]
- IntervalsT: Repeat OnDuration OffDuration OnPower OffPower [Cadence CadenceResting]
- FreeRide: Duration [FlatRoad Cadence]
- MaxEffort: Duration [Cadence]

EXAMPLE FORMAT:
${ORW_FORMAT_EXAMPLE}

Now generate a workout based on the user's requirements. Output ONLY the XML.`;
}

function buildUserPrompt({ durationMinutes, goal, intensity, fitnessLevel, notes, ftp }) {
  const intensityDescriptions = {
    easy: 'Easy/Recovery (Zone 1-2, keep power below 75% FTP, conversational effort)',
    moderate: 'Moderate/Aerobic (Zone 2-3, 65-85% FTP, aerobic base building)',
    hard: 'Hard/Threshold (Zone 3-4, 80-100% FTP, lactate threshold development)',
    very_hard: 'Very Hard/VO2max (Zone 4-5, intervals at 105-120% FTP, maximal aerobic capacity)',
  };

  const goalDescriptions = {
    endurance: 'Build aerobic base and endurance. Use long steady-state blocks at moderate power.',
    intervals: 'High-intensity interval training (HIIT). Use repeated hard intervals with recoveries.',
    threshold: 'Raise lactate threshold. Focus on sustained efforts at 88-100% FTP.',
    recovery: 'Active recovery. Keep everything below 65% FTP. Very easy spinning.',
    climbing: 'Simulate climbing. Use long sustained efforts at 80-95% FTP with occasional surges.',
    race_prep: 'Race preparation. Mix of threshold, VO2max efforts, and race-pace simulation.',
    sweet_spot: 'Sweet spot training. Sustained efforts at 88-93% FTP for maximum aerobic adaptation.',
  };

  const totalSeconds = durationMinutes * 60;
  return `Athlete Profile:
- FTP: ${ftp}W
- Fitness Level: ${fitnessLevel}
- Requested Duration: ${durationMinutes} minutes = EXACTLY ${totalSeconds} seconds total
- Training Goal: ${goalDescriptions[goal] || goal}
- Intensity Level: ${intensityDescriptions[intensity] || intensity}
${notes ? `- Additional Notes: ${notes}` : ''}

DURATION CHECK (mandatory before outputting XML):
  Sum all segment seconds: each plain segment uses its Duration attribute;
  each IntervalsT contributes Repeat × (OnDuration + OffDuration).
  Grand total must be within ±20 s of ${totalSeconds}. Adjust Cooldown if needed.

Generate a complete ${durationMinutes}-minute workout in .orw XML format tailored to this athlete.
Make it engaging, with varied segments and motivational coach messages. Output ONLY the XML.`;
}

async function callOpenAI({ apiKey, systemPrompt, userPrompt, durationMinutes }) {
  // Longer workouts need more tokens to describe all segments
  const maxTokens = Math.max(2000, Math.ceil(durationMinutes * 30));
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API error ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic({ apiKey, systemPrompt, userPrompt, durationMinutes }) {
  const maxTokens = Math.max(2000, Math.ceil(durationMinutes * 30));
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

function extractXml(rawText) {
  // Strip any markdown code fences if the LLM added them
  let text = rawText.trim();
  const fenceMatch = text.match(/```(?:xml)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  // Ensure it starts with the XML declaration
  const xmlStart = text.indexOf('<?xml');
  if (xmlStart > 0) {
    text = text.substring(xmlStart);
  }
  return text;
}

function validateXml(xml) {
  const required = [
    '<workout_file>',
    '<name>',
    '<workout>',
    '<category>My Workouts</category>',
  ];
  for (const tag of required) {
    if (!xml.includes(tag)) {
      throw new Error(`Generated workout is missing required element: ${tag}`);
    }
  }
}

/**
 * Generate a workout using the configured LLM provider.
 *
 * @param {object} params
 * @param {number} params.durationMinutes
 * @param {string} params.goal        - endurance | intervals | threshold | recovery | climbing | race_prep | sweet_spot
 * @param {string} params.intensity   - easy | moderate | hard | very_hard
 * @param {string} params.fitnessLevel - beginner | intermediate | advanced
 * @param {string} params.notes       - optional free-text notes
 * @returns {Promise<string>} Raw XML string of the generated workout
 */
export async function generateWorkout(params) {
  const { provider, apiKey } = loadAiSettings();

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('No API key configured. Add your API key in Settings → AI Workout Generator.');
  }

  const settings = JSON.parse(localStorage.getItem('openride_settings') || '{}');
  const ftp = settings.ftp || 200;

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({ ...params, ftp });

  let raw;
  if (provider === 'anthropic') {
    raw = await callAnthropic({ apiKey: apiKey.trim(), systemPrompt, userPrompt, durationMinutes: params.durationMinutes });
  } else {
    raw = await callOpenAI({ apiKey: apiKey.trim(), systemPrompt, userPrompt, durationMinutes: params.durationMinutes });
  }

  const xml = extractXml(raw);
  validateXml(xml);
  return xml;
}

/**
 * Parse and save a generated workout entirely client-side.
 * No backend call is made — the workout lives in localStorage only.
 *
 * @param {string} xml           Raw .orw XML
 * @param {string} [customName]  Optional name override. When provided the
 *                                <name> tag in the XML is replaced before
 *                                parsing so the custom name flows through to
 *                                the id, display name, and stored XML.
 * @returns {object} The full parsed workout object (same shape as /api/workouts/:id).
 */
export function saveWorkout(xml, customName) {
  let finalXml = xml;
  if (customName && customName.trim()) {
    finalXml = xml.replace(/<name>[^<]*<\/name>/, `<name>${customName.trim()}</name>`);
  }
  const parsed = parseOrwXml(finalXml);
  saveCustomWorkoutLocally({ ...parsed, xml: finalXml });
  return parsed;
}

/**
 * Delete a custom workout from localStorage.
 */
export function deleteCustomWorkout(id) {
  removeCustomWorkoutLocally(id);
}

/**
 * Rename a custom workout in localStorage.
 */
export function renameCustomWorkout(id, newName) {
  renameCustomWorkoutLocally(id, newName);
}
