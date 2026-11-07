import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

export default function RouteWorkoutCard({ route, onRename, onDelete }) {
  const [dialogMode, setDialogMode] = useState(null);
  const profile = useMemo(() => {
    const points = route.points || [];
    const step = Math.max(1, Math.ceil(points.length / 200));
    const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    const range = Math.max(1, route.maxEle - route.minEle);
    return sampled.map(p => `${(p.distanceFromStart / (route.totalDistance || 1)) * 400},${90 - ((p.ele - route.minEle) / range) * 65}`).join(' ');
  }, [route]);

  return <div className="workout-card-wrapper route-workout-card">
    <Link to={`/route?routeId=${encodeURIComponent(route.id)}`} className="workout-card">
      <div className="workout-card-image route-workout-preview">
        <svg viewBox="0 0 400 110" role="img" aria-label="Route elevation profile">
          <polygon points={`0,110 ${profile} 400,110`} fill="rgba(0,212,255,0.12)" />
          <polyline points={profile} fill="none" stroke="#00d4ff" strokeWidth="3" />
        </svg>
      </div>
      <div className="workout-card-content">
        <div className="workout-type">{route.curated ? 'Curated ride · Audio included' : 'Personal route · On this device'}</div>
        <h3 className="workout-title">{route.name}</h3>
        <div className="workout-meta">{route.totalDistance.toFixed(1)} km · +{Math.round(route.elevationGain)} m climbing</div>
        <p className="workout-description">{route.curated ? route.description : 'Automatic training with a warm-up, varied efforts and a cooldown.'}</p>
        {route.curated && route.guide && <p className="public-route-caption">{route.guide.stops.length} stories · ~{Math.round(route.guide.stops.reduce((sum, stop) => sum + (stop.audioSeconds || 0), 0) / 60)} min narration</p>}
      </div>
    </Link>
    {dialogMode && <RouteWorkoutDialog route={route} mode={dialogMode} onRename={onRename} onDelete={onDelete} onClose={() => setDialogMode(null)} />}
    <div className="workout-card-actions">
      <button type="button" className="workout-card-rename" onClick={() => setDialogMode('rename')} aria-label={`Rename ${route.name}`} title="Rename route">✎</button>
      <button type="button" className="workout-card-delete" onClick={() => setDialogMode('delete')} aria-label={`Delete ${route.name}`} title="Delete route">×</button>
    </div>
  </div>;
}

function RouteWorkoutDialog({ route, mode, onRename, onDelete, onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const [name, setName] = useState(route.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const deleting = mode === 'delete';

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      requestAnimationFrame(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
    };
  }, []);

  const submit = async event => {
    event.preventDefault();
    if (busy || (!deleting && !name.trim())) return;
    setBusy(true);
    setError('');
    try {
      if (deleting) await onDelete(route);
      else await onRename(route, name.trim());
      onClose();
    } catch {
      setError(`Could not ${deleting ? 'delete' : 'rename'} this route. Please try again.`);
      setBusy(false);
    }
  };

  return <dialog ref={dialogRef} className="route-action-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <div className="route-dialog-eyebrow">Route workout</div>
      <h2 id={titleId}>{deleting ? 'Delete route?' : 'Rename route'}</h2>
      <p id={descriptionId}>{deleting ? `“${route.name}” will be removed from this device. Your completed ride history will stay.` : 'Choose a name that makes this route easy to find.'}</p>
      {!deleting && <label className="route-dialog-field">Route name<input autoFocus value={name} maxLength={120} onChange={event => setName(event.target.value)} required disabled={busy} /></label>}
      {error && <p role="alert">{error}</p>}
      <div className="route-dialog-actions">
        <button type="button" className="route-dialog-cancel" autoFocus={deleting} disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className={deleting ? 'route-dialog-delete' : 'route-dialog-save'} disabled={busy || (!deleting && !name.trim())}>{busy ? (deleting ? 'Deleting…' : 'Saving…') : deleting ? 'Delete route' : 'Save name'}</button>
      </div>
    </form>
  </dialog>;
}
