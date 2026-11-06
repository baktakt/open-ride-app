/** Short caption cues for a single prerecorded story. No speech provider is involved. */
export function captionChunks(text, limit = 76) {
  const chunks = [];
  let chunk = '';
  for (const word of String(text || '').trim().split(/\s+/).filter(Boolean)) {
    if (chunk && (chunk.length + word.length + 1 > limit || /[.!?]$/.test(chunk))) { chunks.push(chunk); chunk = ''; }
    chunk += `${chunk ? ' ' : ''}${word}`;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function guideMilestone(stops, distanceKm) {
  const completed = stops.filter(stop => stop.status === 'heard').length;
  const active = stops.find(stop => stop.status === 'active');
  const next = stops.find(stop => stop.status === 'upcoming' && stop.distanceKm >= distanceKm - 0.1);
  const previous = [...stops].reverse().find(stop => stop.distanceKm < (next?.distanceKm ?? Infinity));
  const start = previous?.distanceKm || 0;
  const remainingKm = next ? Math.max(0, next.distanceKm - distanceKm) : 0;
  const progress = next ? Math.max(0, Math.min(1, (distanceKm - start) / Math.max(.01, next.distanceKm - start))) : 1;
  return { completed, active, next, remainingKm, progress, total: stops.length };
}

/** Cancellable playback with compact captions, duration-based timing and real pause/resume. */
export function createCuratedPlayer({ narrator, onSentence, onDone, onNotice = () => {}, now = () => performance.now(), schedule = setTimeout, unschedule = clearTimeout }) {
  let story = null;
  let chunks = [];
  let durationMs = 0;
  let offsetMs = 0;
  let startedAt = 0;
  let ticking = false;
  let paused = false;
  let voiced = true;
  let timer;
  let watchdog;
  let cancelAudio;
  let generation = 0;
  let lastCaption = -1;
  const elapsed = () => offsetMs + (ticking ? Math.max(0, now() - startedAt) : 0);
  const cancel = () => { generation++; unschedule(timer); unschedule(watchdog); cancelAudio?.(); cancelAudio = null; ticking = false; };
  const finish = () => { const finished = story; cancel(); story = null; onSentence(null); onDone?.(finished); };
  const caption = () => {
    if (!story) return;
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    let threshold = Math.min(.999, elapsed() / durationMs) * total;
    let index = 0;
    while (index < chunks.length - 1 && threshold >= chunks[index].length) threshold -= chunks[index++].length;
    if (index !== lastCaption) { lastCaption = index; onSentence({ landmark: story, text: chunks[index], index, total: chunks.length }); }
  };
  const tick = () => { if (!story || paused) return; caption(); if (elapsed() >= durationMs && !voiced) finish(); else timer = schedule(tick, 150); };
  const begin = () => {
    const token = generation;
    caption();
    const startClock = () => { startedAt = now(); ticking = true; tick(); };
    const fallback = message => {
      if (token !== generation || !story) return;
      offsetMs = elapsed(); cancel(); voiced = false; onNotice(message); startClock();
    };
    if (!voiced) { startClock(); return; }
    watchdog = schedule(() => fallback('Audio is unavailable. Keep riding with captions.'), 12000);
    try {
      const stop = narrator.speak(story.text, story.language, {
        landmark: story, offset: offsetMs / 1000,
        onStart: details => {
          if (token !== generation || !story) return;
          unschedule(watchdog);
          if (details?.duration > 0) durationMs = details.duration * 1000;
          startClock();
          watchdog = schedule(() => fallback('Audio was interrupted. Your story continues in captions.'), durationMs - offsetMs + 5000);
        },
        onEnd: () => { if (token === generation && story) finish(); },
        onError: fallback,
      });
      if (token === generation) cancelAudio = stop; else stop?.();
    } catch { fallback('Audio is unavailable. Keep riding with captions.'); }
  };
  return {
    get active() { return Boolean(story); },
    play(landmark, withAudio = true) {
      cancel(); story = landmark; chunks = captionChunks(landmark.text); if (!chunks.length) { finish(); return; }
      durationMs = (landmark.audioSeconds || Math.max(8, landmark.text.split(/\s+/).length / 2.4)) * 1000;
      offsetMs = 0; lastCaption = -1; paused = false; voiced = withAudio; begin();
    },
    setPaused(value) { if (value === paused) return; offsetMs = elapsed(); cancel(); paused = value; if (!paused && story) begin(); },
    stop() { cancel(); story = null; paused = false; onSentence(null); },
  };
}

/** Read-only downloads. Cache identity follows the editorial guide version, not just geometry. */
export async function downloadCuratedGuide(route, { signal, fetchImpl = fetch, apiBase = '', loadGuide, saveGuide, onRecord = () => {}, onProgress = () => {} }) {
  const guide = route.curated && route.guide;
  if (!guide?.stops?.length) return null;
  let existing;
  try { existing = await loadGuide(guide.routeHash, guide.language); } catch { /* Play in memory if browser storage is unavailable. */ }
  let record = { guide, clips: existing?.guide.id === guide.id ? existing.clips : {} };
  onRecord(record);
  for (let index = 0; index < guide.stops.length; index++) {
    signal?.throwIfAborted();
    const stop = guide.stops[index];
    if (record.clips[stop.id]) continue;
    onProgress(`Preparing stories ${index + 1} of ${guide.stops.length}…`);
    const response = await fetchImpl(`${apiBase}/api/public-routes/${encodeURIComponent(route.publicSource)}/audio/${encodeURIComponent(stop.id)}`, { signal });
    if (!response.ok) throw new Error('Some audio is unavailable. You can still ride with captions.');
    record = { guide, clips: { ...record.clips, [stop.id]: await response.blob() } };
    signal?.throwIfAborted();
    try { await saveGuide(guide, record.clips); } catch { /* A full browser cache must not prevent listening. */ }
    onRecord(record);
  }
  onProgress('Stories ready · no AI key needed');
  return record;
}
