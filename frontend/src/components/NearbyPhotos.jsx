import React, { useEffect, useMemo, useState } from 'react';
import { positionAt } from '../services/routeProfile';

function distanceM(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.lng) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function safeLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : undefined; } catch { return undefined; }
}

export default function NearbyPhotos({ routePoints, distanceKm }) {
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState({ state: 'idle', places: [] });
  const [retry, setRetry] = useState(0);
  // Refresh every 500 m, rather than on every telemetry tick. No GPX file is sent.
  const section = Math.floor(distanceKm / 0.5);
  const searchPosition = useMemo(() => positionAt(routePoints, section * 0.5), [routePoints, section]);
  const currentPosition = positionAt(routePoints, distanceKm);
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';

  useEffect(() => {
    if (!enabled || !searchPosition) return undefined;
    const controller = new AbortController();
    setSelected(0);
    setResult({ state: 'loading', places: [] });
    fetch(`${apiBase}/api/nearby-photos?lat=${searchPosition.lat}&lng=${searchPosition.lng}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Nearby photos are unavailable.');
        if (!controller.signal.aborted) setResult({ state: 'ready', places: data.places || [] });
      })
      .catch(error => { if (!controller.signal.aborted) setResult({ state: 'error', places: [], message: error.message }); });
    return () => controller.abort();
  }, [enabled, searchPosition, retry, apiBase]);

  return <section className="nearby-photos" aria-label="Nearby place photos">
    <div className="nearby-photos-heading"><h2>Nearby places</h2>
      {enabled && <button type="button" onClick={() => { setEnabled(false); setResult({ state: 'idle', places: [] }); }}>Hide photos</button>}
    </div>
    {!enabled ? <><p>See Google Places photos along your ride. Enabling photos shares the current route location with Google; opening photos also connects your browser to Google.</p><button type="button" onClick={() => setEnabled(true)}>Show nearby photos</button></> : <>
      <div role="status">
        {result.state === 'loading' && 'Finding nearby photos…'}
        {result.state === 'ready' && !result.places.length && 'No place photos found within 1.5 km. Photos refresh as you ride.'}
        {result.state === 'error' && <>{result.message} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></>}
      </div>
      <div className="nearby-photo-grid">
        {result.places.slice(selected, selected + 1).map(place => {
          const meters = currentPosition ? distanceM(currentPosition, place.location) : place.distanceM;
          return <figure className="nearby-photo" key={place.photoUrl}>
            <PlacePhoto src={`${apiBase}${place.photoUrl}`} name={place.name} />
            <figcaption>
              <a href={safeLink(place.mapsUri)} target="_blank" rel="noopener noreferrer">{place.name}</a>
              <span>{meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`} away · straight-line distance</span>
              <span className="nearby-photo-authors">Photo: {place.authors.length ? place.authors.map((author, i) => <React.Fragment key={i}>{i > 0 && ', '}<a href={safeLink(author.uri)} target="_blank" rel="noopener noreferrer">{author.displayName || 'Google Maps contributor'}</a></React.Fragment>) : 'Google Maps contributors'}</span>
            </figcaption>
          </figure>;
        })}
      </div>
      {result.places.length > 1 && <div className="nearby-photo-navigation" aria-label="Photo navigation">
        <button type="button" aria-label="Previous place photo" onClick={() => setSelected(value => (value - 1 + result.places.length) % result.places.length)}>←</button>
        <span>{selected + 1} / {result.places.length}</span>
        <button type="button" aria-label="Next place photo" onClick={() => setSelected(value => (value + 1) % result.places.length)}>→</button>
      </div>}
      <img className="google-photos-attribution" src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" width="120" height="14" />
    </>}
  </section>;
}

function PlacePhoto({ src, name }) {
  const [failed, setFailed] = useState(false);
  return failed ? <div className="nearby-photo-unavailable">Photo unavailable</div> : <img src={src} alt={name} onError={() => setFailed(true)} />;
}
