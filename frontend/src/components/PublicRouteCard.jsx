import React from 'react';
import { Link } from 'react-router-dom';

export default function PublicRouteCard({ route }) {
  return <Link to={`/route?publicRoute=${encodeURIComponent(route.id)}`} className={`workout-card public-route-card theme-${route.theme?.toLowerCase().replace(/[^a-z]+/g, '-') || 'community'}`}>
    <div className="workout-card-image public-route-preview">
      <svg viewBox="0 0 400 110" role="img" aria-label="Route overview"><path d={route.previewPath || 'M180,65L200,35L220,65'} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span>Open Ride collection</span>
    </div>
    <div className="workout-card-content"><div className="workout-type">{route.theme || 'Curated route'}{route.hasGuide ? ' · Audio included' : ''}</div><h3 className="workout-title">{route.name}</h3>
      <div className="workout-meta">~{route.estimatedMinutes} min · {route.totalDistance.toFixed(1)} km · +{Math.round(route.elevationGain)} m</div>
      <p className="workout-description">{route.description}</p>
      {route.contentNote && <p className="public-route-note">{route.contentNote}</p>}
      <p className="public-route-caption">{route.hasGuide ? `${route.storyCount} stories · ~${Math.max(1, Math.round(route.narrationSeconds / 60))} min narration · quiet riding between` : 'Ride at your own pace'}</p>
    </div>
  </Link>;
}
