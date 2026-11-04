import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

export default function RouteWorkoutCard({ route, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(route.name);
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
        <div className="workout-type">Route workout</div>
        <h3 className="workout-title">{route.name}</h3>
        <div className="workout-meta">{route.totalDistance.toFixed(1)} km · +{Math.round(route.elevationGain)} m climbing</div>
        <p className="workout-description">Ride at your own pace. Trainer resistance follows the route elevation.</p>
      </div>
    </Link>
    {editing && <form className="route-rename-form" onSubmit={async event => {
      event.preventDefault();
      if (!name.trim()) return;
      await onRename(route, name.trim());
      setEditing(false);
    }}>
      <input autoFocus aria-label="Route workout name" value={name} maxLength={120} onChange={event => setName(event.target.value)} required />
      <button type="submit">Save</button>
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
    </form>}
    {confirmDelete && <div className="route-rename-form">
      <p>Delete this route workout from this device?</p>
      <button type="button" onClick={() => onDelete(route)}>Delete route workout</button>
      <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
    </div>}
    <div className="workout-card-actions">
      <button type="button" className="workout-card-rename" onClick={() => { setName(route.name); setEditing(true); }} aria-label={`Rename ${route.name}`} title="Rename route">✎</button>
      <button type="button" className="workout-card-delete" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${route.name}`} title="Delete route">×</button>
    </div>
  </div>;
}
