import React, { useEffect, useMemo, useState } from 'react';
import { guidePhotoQuery, guidePhotoStops } from '../services/guidePhotos';

export default function GuidePhotos({ guide, distanceKm, onPlacesChange }) {
  const [enabled, setEnabled] = useState(true);
  const [result, setResult] = useState({ key: '', photos: [], error: false });
  const [retry, setRetry] = useState(0);
  const stops = guidePhotoStops(guide.stops, distanceKm, guide.subtitle?.landmark.id);
  const lookups = stops.map(stop => ({ id: stop.id, query: guidePhotoQuery(stop.landmark) })).filter(item => item.query);
  const key = JSON.stringify(lookups);
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const queries = JSON.parse(key);
    Promise.allSettled(queries.map(async item => {
      const response = await fetch(`${apiBase}/api/guide-photos?${new URLSearchParams(item.query)}`, { signal: controller.signal });
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json();
      return data.photo ? { ...data.photo, stopId: item.id } : null;
    })).then(results => {
      const photos = results.filter(item => item.status === 'fulfilled' && item.value).map(item => item.value);
      if (!controller.signal.aborted) setResult({ key, photos, error: !photos.length && results.some(item => item.status === 'rejected') });
    }).catch(() => { if (!controller.signal.aborted) setResult({ key, photos: [], error: true }); });
    return () => controller.abort();
  }, [key, enabled, retry, apiBase]);
  const photos = useMemo(() => JSON.parse(key).map(item => result.photos.find(photo => photo.stopId === item.id)).filter(Boolean)
    .filter((photo, index, all) => all.findIndex(item => item.imageUrl === photo.imageUrl) === index), [result, key]);
  useEffect(() => {
    onPlacesChange?.(enabled ? photos.filter(photo => Number.isFinite(photo.lat) && Number.isFinite(photo.lng)).map(photo => ({ name: photo.title, photoUrl: photo.imageUrl, location: { latitude: photo.lat, longitude: photo.lng } })) : []);
    return () => onPlacesChange?.([]);
  }, [photos, enabled, onPlacesChange]);
  return <section className="nearby-photos guide-photos" aria-label="Tour guide photos">
    <div className="nearby-photos-heading"><h2>Places in your story</h2><button type="button" onClick={() => setEnabled(value => !value)}>{enabled ? 'Hide photos' : 'Show photos'}</button></div>
    {!enabled ? <p>Photos of the places in your guide, provided by Wikimedia Commons.</p> : <>
      {result.key !== key && <p role="status">Finding photos for the guide…</p>}
      {result.key === key && result.error && <p role="status">Guide photos are unavailable. <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
      {result.key === key && !result.error && !photos.length && <p>No matching free photos for these guide stops yet.</p>}
      <div className={`nearby-photo-grid guide-photo-grid guide-photo-count-${Math.min(3, photos.length)}`}>{photos.slice(0, 3).map((photo, index) => {
        const stop = stops.find(item => item.id === photo.stopId);
        return <figure className={`nearby-photo${index === 0 ? ' guide-photo-featured' : ''}${photo.stopId === guide.subtitle?.landmark.id ? ' guide-photo-active' : ''}`} key={photo.imageUrl}>
          <img src={photo.imageUrl} alt={photo.title} referrerPolicy="no-referrer" />
          <figcaption><strong>{photo.stopId === guide.subtitle?.landmark.id ? 'Now playing' : stop?.status === 'heard' ? 'Just passed' : index === 0 ? (guide.isRiding ? 'Your next story' : 'First story') : 'Coming up'}</strong><a href={photo.pageUrl} target="_blank" rel="noopener noreferrer">{photo.title}</a><span>{photo.author} · <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">{photo.license}</a></span></figcaption>
        </figure>;
      })}</div>
      <small className="guide-photo-credit">Photos: Wikimedia Commons · current and upcoming guide places</small>
    </>}
  </section>;
}
