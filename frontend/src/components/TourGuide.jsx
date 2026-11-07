import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPreparedNarrator } from '../services/preparedSpeech';
import { loadPreparedGuide, savePreparedGuide } from '../services/guideLibrary';
import { captionChunks, createCuratedPlayer, downloadCuratedGuide, guideMilestone } from '../services/curatedGuide';

export function useTourGuide({ route, distanceKm, isRiding, isPaused }) {
  const [enabled, setEnabled] = useState(true);
  const [record, setRecord] = useState(null);
  const [subtitle, setSubtitle] = useState(null);
  const [notice, setNotice] = useState('');
  const [audioStatus, setAudioStatus] = useState('');
  const [retry, setRetry] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [heard, setHeard] = useState(() => new Set());
  const visited = useRef(new Set());
  const recordRef = useRef(record);
  recordRef.current = record;
  const previousRiding = useRef(false);
  const ridingRef = useRef(isRiding);
  ridingRef.current = isRiding;
  const narration = route?.curated ? route.guide : null;
  const hasGuide = Boolean(narration?.stops.length);
  const narrator = useMemo(() => createPreparedNarrator({ getRecord: () => recordRef.current }), []);
  const player = useMemo(() => createCuratedPlayer({ narrator, onSentence: setSubtitle, onNotice: setNotice,
    onDone: landmark => { if (landmark && ridingRef.current) setHeard(previous => new Set([...previous, landmark.id])); },
  }), [narrator]);
  useEffect(() => () => { player.stop(); narrator.dispose(); }, [player, narrator]);
  useEffect(() => {
    const controller = new AbortController();
    player.stop(); visited.current.clear(); setHeard(new Set()); setRecord(null); setNotice(''); setEnabled(true); setAudioReady(false);
    if (hasGuide) {
      setAudioStatus('Preparing included stories…');
      downloadCuratedGuide(route, { signal: controller.signal, apiBase: import.meta.env.VITE_API_BASE_URL || '', loadGuide: loadPreparedGuide, saveGuide: savePreparedGuide,
        onRecord: value => { if (!controller.signal.aborted) setRecord(value); },
        onProgress: value => { if (!controller.signal.aborted) setAudioStatus(value); },
      }).catch(error => { if (!controller.signal.aborted) { setAudioStatus('Audio unavailable · captions included'); setNotice(error.message); } });
    }
    return () => controller.abort();
  }, [route, hasGuide, retry, player]);
  const enableSaved = useCallback(async () => {
    try { await narrator.enable(); setAudioReady(true); setNotice(''); }
    catch { setNotice('Audio is unavailable in this browser. Your stories will appear as captions.'); setAudioReady(false); }
  }, [narrator]);
  const toggle = useCallback(value => {
    setEnabled(value);
    if (value) enableSaved(); else player.stop();
  }, [enableSaved, player]);
  useEffect(() => {
    if (isRiding && !previousRiding.current) { player.stop(); visited.current.clear(); setHeard(new Set()); }
    if (!isRiding && previousRiding.current) player.stop();
    player.setPaused(isPaused);
    previousRiding.current = isRiding;
  }, [isRiding, isPaused, player]);
  const plannedStops = useMemo(() => hasGuide ? narration.stops.map(stop => ({ ...stop, landmark: {
    ...stop, language: narration.language, prepared: true, url: stop.sources[0]?.url,
  } })) : [], [narration, hasGuide]);
  useEffect(() => {
    if (!enabled || !isRiding || isPaused || player.active || !plannedStops.length) return;
    // Queue the earliest unplayed chapter. Downloads or a fast section never silently skip a story.
    const stop = plannedStops.find(item => !visited.current.has(item.id) && item.distanceKm <= distanceKm + .02);
    if (!stop) return;
    if (audioReady && !record?.clips[stop.id] && !audioStatus.includes('unavailable')) return;
    visited.current.add(stop.id);
    player.play(stop.landmark, audioReady && Boolean(record?.clips[stop.id]));
  }, [enabled, isRiding, isPaused, player, plannedStops, distanceKm, record, audioReady, audioStatus, heard]);
  const stops = useMemo(() => enabled ? plannedStops.map(stop => ({ ...stop,
    status: subtitle?.landmark.id === stop.id ? 'active' : heard.has(stop.id) ? 'heard' : 'upcoming',
  })) : [], [plannedStops, subtitle, heard, enabled]);
  const preview = useCallback(async () => {
    if (isRiding || !plannedStops.length) return;
    await enableSaved();
    player.play(plannedStops[0].landmark, Boolean(record?.clips[plannedStops[0].id]));
  }, [isRiding, plannedStops, enableSaved, record, player]);
  return { mode: hasGuide && enabled ? 'prepared' : 'off', hasGuide, enabled, toggle, enableSaved, subtitle, notice, audioStatus,
    preview, retryAudio: () => setRetry(value => value + 1), isRiding, isPaused, stops, allStops: plannedStops, distanceKm, audioReady, previewReady: Boolean(record?.clips[plannedStops[0]?.id]) };
}

/** Pre-ride choices stay beside Start Ride; listeners never see voice engines or creation tools. */
export function TourGuideControls({ guide }) {
  if (!guide.hasGuide) return <p className="personal-route-note">Your GPX stays on this device. Your workout runs automatically while you enjoy nearby photos.</p>;
  const seconds = guide.allStops.reduce((sum, stop) => sum + (stop.audioSeconds || stop.text.split(/\s+/).length / 2.4), 0);
  if (guide.isRiding) return <div className="ride-guide-setup ride-guide-active">
    <label><input type="checkbox" checked={guide.enabled} onChange={event => guide.toggle(event.target.checked)} />Guide audio</label>
    {guide.notice && <small role="status">{guide.notice}</small>}
  </div>;
  return <div className="ride-guide-setup">
    <label><input type="checkbox" checked={guide.enabled} onChange={event => guide.toggle(event.target.checked)} />Listen to the guide</label>
    <p>{guide.allStops.length} stories · about {Math.max(1, Math.round(seconds / 60))} min of narration</p>
    <small>Quiet riding between stories. Audio and captions included.</small>
    {guide.enabled && <>
      <small role="status">{guide.audioStatus}</small>
      {!guide.isRiding && <button type="button" className="guide-preview-button" onClick={guide.preview} disabled={!guide.previewReady}>Preview first story</button>}
      {guide.notice && <p role="status">{guide.notice} <button type="button" onClick={guide.retryAudio}>Retry audio</button></p>}
    </>}
  </div>;
}

export function TourGuideProgress({ guide }) {
  if (!guide.hasGuide || !guide.enabled || guide.subtitle) return null;
  const { next, completed, remainingKm, progress, total } = guideMilestone(guide.stops, guide.distanceKm);
  const distance = remainingKm < 1 ? `${Math.round(remainingKm * 1000)} m` : `${remainingKm.toFixed(1)} km`;
  return <aside className="tour-guide-milestone" aria-label="Next story milestone">
    <span className="story-collection">{completed} / {total} stories explored</span>
    <strong>{!guide.isRiding ? 'Your first story starts when you ride' : guide.isPaused ? 'Your next story will wait for you' : next ? `Keep pedalling · ${distance} to your next story` : 'Every story explored. Enjoy the finish!'}</strong>
    {next && <><span>{next.title}</span><progress value={progress} max="1" aria-label="Progress to next story" /></>}
  </aside>;
}

export function TourGuideSubtitles({ guide }) {
  if (guide.mode === 'off' || !guide.subtitle) return null;
  const { landmark, text } = guide.subtitle;
  const index = guide.allStops.findIndex(stop => stop.id === landmark.id);
  return <aside className="tour-guide-subtitles" aria-label="Tour guide subtitles">
    <div className="tour-guide-caption-heading"><strong>{landmark.title}</strong><span>{guide.isPaused ? 'Paused' : `Story ${index + 1} unlocked · ${guide.allStops.length} total`}</span></div>
    <p aria-live="off">{text || captionChunks(landmark.text)[0]}</p>
    <a className="tour-guide-story-source" href={landmark.url} target="_blank" rel="noopener noreferrer">Story source</a>
  </aside>;
}
