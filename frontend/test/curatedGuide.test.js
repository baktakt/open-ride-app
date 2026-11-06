import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreparedNarrator } from '../src/services/preparedSpeech.js';
import { captionChunks, guideMilestone, createCuratedPlayer, downloadCuratedGuide } from '../src/services/curatedGuide.js';

function clock() {
  let time = 0; let id = 0; const timers = new Map();
  return { now: () => time, schedule(fn, delay) { timers.set(++id, { fn, due: time + delay }); return id; }, unschedule(key) { timers.delete(key); },
    advance(ms) { const end = time + ms; while (true) { const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0]; if (!next || next[1].due > end) break; time = next[1].due; timers.delete(next[0]); next[1].fn(); } time = end; },
  };
}
const text = 'A short opening sentence about the first landmark. The second sentence adds an interesting detail to the story. Keep pedalling to explore the next place.';
const landmark = { id: 'first', text, language: 'en', audioSeconds: 20 };

test('compact captions preserve the entire reviewed story without a paragraph overlay', () => {
  const cues = captionChunks(text);
  assert.equal(cues.join(' '), text);
  assert.ok(cues.length > 2);
  assert.ok(cues.every(cue => cue.length <= 76));
});

test('story milestones reward completed chapters and measure progress towards the next one', () => {
  const stops = [{ id: 'a', distanceKm: 0, status: 'heard' }, { id: 'b', title: 'A castle', distanceKm: 4, status: 'upcoming' }];
  const result = guideMilestone(stops, 3);
  assert.equal(result.completed, 1); assert.equal(result.next.title, 'A castle'); assert.equal(result.remainingKm, 1); assert.equal(result.progress, .75);
  assert.equal(guideMilestone(stops.map(stop => ({ ...stop, status: 'heard' })), 5).next, undefined);
});

test('recorded audio drives caption cues, pauses at its position and ignores cancelled callbacks', () => {
  const time = clock(); let events; let subtitle; let finished = 0; const offsets = [];
  const player = createCuratedPlayer({ ...time, narrator: { speak(_text, _language, callbacks) { events = callbacks; offsets.push(callbacks.offset); callbacks.onStart({ duration: 20 }); return () => {}; } }, onSentence: value => { subtitle = value; }, onDone: () => finished++ });
  player.play(landmark);
  assert.equal(subtitle.index, 0);
  time.advance(9000); assert.ok(subtitle.index > 0);
  const beforePause = subtitle.index;
  player.setPaused(true); const stale = events;
  time.advance(30000); assert.equal(subtitle.index, beforePause);
  player.setPaused(false); assert.ok(Math.abs(offsets[1] - 9) < .1);
  stale.onEnd(); assert.equal(finished, 0);
  events.onEnd(); assert.equal(finished, 1); assert.equal(subtitle, null);
});

test('audio failure still delivers every story caption and completes the milestone', () => {
  const time = clock(); const cues = []; let finished = 0;
  const player = createCuratedPlayer({ ...time, narrator: { speak(_text, _language, events) { events.onError('Unavailable'); return () => {}; } }, onSentence: value => { if (value) cues.push(value.text); }, onDone: () => finished++ });
  player.play(landmark); time.advance(21000);
  assert.equal(finished, 1); assert.deepEqual(cues, captionChunks(text));
});

test('curated audio downloads use anonymous reads, retain completed work, and replace old editorial versions', async () => {
  const route = { curated: true, publicSource: 'collection-id', guide: { id: 'new-edition', routeHash: 'hash', language: 'en', stops: [{ id: 'one' }, { id: 'two' }] } };
  let saved; const snapshots = [];
  await assert.rejects(downloadCuratedGuide(route, {
    loadGuide: async () => ({ guide: { id: 'old-edition' }, clips: { one: new Blob(['outdated']) } }),
    saveGuide: async (guide, clips) => { saved = { guide, clips }; }, onRecord: value => snapshots.push(value),
    fetchImpl: async (url, options) => { assert.equal(options.headers, undefined); assert.ok(url.startsWith('/api/public-routes/')); return url.endsWith('/one') ? new Response('new audio') : new Response('', { status: 503 }); },
  }), /still ride with captions/);
  assert.equal(saved.guide.id, 'new-edition'); assert.equal(await saved.clips.one.text(), 'new audio'); assert.equal(saved.clips.two, undefined);
  assert.equal(snapshots[0].clips.one, undefined);
  let requests = 0;
  await downloadCuratedGuide(route, { loadGuide: async () => saved, saveGuide: async () => {}, fetchImpl: async () => { requests++; return new Response('second audio'); } });
  assert.equal(requests, 1);
  assert.equal(await downloadCuratedGuide({ curated: false, guide: route.guide }, { fetchImpl: assert.fail }), null);
});

test('unavailable browser storage does not prevent playing included audio in memory', async () => {
  const guide = { id: 'edition', routeHash: 'hash', language: 'en', stops: [{ id: 'one' }] };
  const record = await downloadCuratedGuide({ curated: true, publicSource: 'ride', guide }, {
    loadGuide: async () => { throw new Error('Storage unavailable'); },
    saveGuide: async () => { throw new Error('Quota exceeded'); }, fetchImpl: async () => new Response('included audio'),
  });
  assert.equal(await record.clips.one.text(), 'included audio');
});


test('saved narration plays without credentials, caches decoding and cancels paused audio', async () => {
  let starts = 0;
  let stops = 0;
  let decodes = 0;
  class AudioContextClass {
    state = 'running';
    async resume() {}
    async decodeAudioData() { decodes++; return {}; }
    async close() {}
    createBufferSource() { return { connect() {}, disconnect() {}, start() { starts++; }, stop() { stops++; } }; }
  }
  const narrator = createPreparedNarrator({ getRecord: () => ({ guide: { id: 'guide' }, clips: { stop: new Blob(['audio']) } }), AudioContextClass });
  await narrator.enable();
  const callbacks = { landmark: { id: 'stop' }, onStart() {}, onEnd() {}, onError: assert.fail };
  const cancel = narrator.speak('Saved text.', 'en', callbacks);
  await new Promise(resolve => setImmediate(resolve));
  cancel();
  narrator.speak('Saved text.', 'en', callbacks);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 2);
  assert.equal(stops, 1);
  assert.equal(decodes, 1);
  narrator.dispose();
});
