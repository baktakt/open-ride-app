import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useRideSession } from '../contexts/RideSessionContext';

export default function ActiveSessionBar() {
  const { session, endSession } = useRideSession();
  const location = useLocation();
  if (!session || session.path === `${location.pathname}${location.search}`) return null;
  const time = `${Math.floor(session.elapsed / 60)}:${String(session.elapsed % 60).padStart(2, '0')}`;
  return <aside className="active-session-bar" aria-label="Active session">
    <div><strong>{session.complete ? 'Ride complete' : session.paused ? 'Paused session' : 'Active session'}</strong><span>{session.name} · {time}</span></div>
    <Link to={session.path}>{session.complete ? 'View summary' : 'Return to ride'}</Link>
    {session.complete && <button type="button" onClick={endSession} aria-label="Dismiss completed session">×</button>}
  </aside>;
}
