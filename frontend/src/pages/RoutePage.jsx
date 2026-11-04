import React, { Component, Suspense, lazy, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import { useAnt } from '../contexts/AntContext';
import TopBar from '../components/TopBar';
import DeviceModal from '../components/DeviceModal';
import RideGauges from '../components/RideGauges';
import NearbyPhotos from '../components/NearbyPhotos';
import { loadRoute } from '../services/routeLibrary';
import { saveRouteRide } from '../services/dataManager';
import { createRideRecorder } from '../services/rideRecorder';
import { computeRideMetrics } from '../services/rideMetrics';
import { buildRouteProfile, gradeAt, elevationAt, elevationGain, positionAt } from '../services/routeProfile';
import { saveRideFile } from '../services/rideFiles';
import { downloadRide } from '../services/rideExport';
import { createRouteMotion } from '../services/routeMotion';
import '../styles/route.css';

// three.js is only downloaded when the 3D view is opened
const Route3DView = lazy(() => import('../components/Route3DView'));

function readFtp() {
  try {
    const stored = JSON.parse(localStorage.getItem('openride_settings') || '{}');
    return parseInt(stored.ftp, 10) || 200;
  } catch (_) {
    return 200;
  }
}

// ── Error Boundary ─────────────────────────────────────────────────────────────

class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="route-crash">
          <strong>Something went wrong rendering the map:</strong>
          <pre>{this.state.error.message}</pre>
          <button type="button" onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Elevation canvas ──────────────────────────────────────────────────────────

function ElevationCanvas({ routePoints, routeStats, currentIndex, isRiding }) {
  const canvasRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState(0);

  useEffect(() => {
    const observer = new ResizeObserver(() => setCanvasSize(value => value + 1));
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || routePoints.length === 0 || canvas.offsetWidth === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cw = canvas.offsetWidth;
    const ch = canvas.offsetHeight;
    const pad = { top: 10, right: 10, bottom: 26, left: 46 };
    const innerW = cw - pad.left - pad.right;
    const innerH = ch - pad.top - pad.bottom;

    const { minEle, maxEle, totalDistance } = routeStats;
    const eleRange = maxEle - minEle || 1;

    if (!totalDistance || totalDistance <= 0) {
      ctx.clearRect(0, 0, cw, ch);
      return;
    }
    const xOf = i => pad.left + (routePoints[i].distanceFromStart / totalDistance) * innerW;
    const yOf = ele => pad.top + innerH - ((ele - minEle) / eleRange) * innerH;

    ctx.clearRect(0, 0, cw, ch);

    ctx.beginPath();
    ctx.moveTo(xOf(0), ch - pad.bottom);
    for (let i = 0; i < routePoints.length; i++) {
      ctx.lineTo(xOf(i), yOf(routePoints[i].ele));
    }
    ctx.lineTo(xOf(routePoints.length - 1), ch - pad.bottom);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, ch - pad.bottom);
    grad.addColorStop(0, 'rgba(0,212,255,0.55)');
    grad.addColorStop(1, 'rgba(0,212,255,0.04)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < routePoints.length; i++) {
      if (i === 0) ctx.moveTo(xOf(i), yOf(routePoints[i].ele));
      else ctx.lineTo(xOf(i), yOf(routePoints[i].ele));
    }
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (isRiding && currentIndex >= 0 && currentIndex < routePoints.length) {
      const x = xOf(currentIndex);
      const y = yOf(routePoints[currentIndex].ele);

      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, ch - pad.bottom);
      ctx.strokeStyle = 'rgba(255,107,53,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff6b35';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = '#888';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const ele = minEle + (eleRange * i) / 4;
      ctx.fillText(`${Math.round(ele)}m`, pad.left - 5, yOf(ele) + 4);
    }

    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const dist = (totalDistance * i) / 4;
      const x = pad.left + (dist / totalDistance) * innerW;
      ctx.fillText(`${dist.toFixed(1)}km`, x, ch - 6);
    }
  }, [routePoints, routeStats, currentIndex, isRiding, canvasSize]);

  return <canvas ref={canvasRef} className="elevation-canvas" />;
}

// ── Leaflet map ───────────────────────────────────────────────────────────────

function RouteMap({ routePoints, distanceKm, distanceKmRef, telemetryRef, isFollowing }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const polylineRef  = useRef(null);
  const markerRef    = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    map.setView([0, 0], 2);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current    = null;
      polylineRef.current = null;
      markerRef.current   = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }
    if (markerRef.current)   { markerRef.current.remove();   markerRef.current   = null; }

    if (routePoints.length === 0) return;

    const latlngs = routePoints.map(p => [p.lat, p.lng]);
    polylineRef.current = L.featureGroup([
      L.polyline(latlngs, { color: '#17243b', weight: 9, opacity: 0.95 }),
      L.polyline(latlngs, { color: '#fff', weight: 6, opacity: 1 }),
      L.polyline(latlngs, { color: '#e63967', weight: 4, opacity: 1 }),
    ]).addTo(map);
    map.fitBounds(polylineRef.current.getBounds(), { padding: [24, 24] });
  }, [routePoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (routePoints.length === 0) {
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
      return;
    }

    const p = positionAt(routePoints, distanceKm);
    if (!p) return;
    const latlng = [p.lat, p.lng];

    if (markerRef.current) {
      if (!isFollowing) markerRef.current.setLatLng(latlng);
    } else {
      markerRef.current = L.marker(latlng, {
        icon: L.divIcon({
          className: 'route-rider-marker',
          iconSize: [44, 44],
          iconAnchor: [22, 22],
          html: '<svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="27" r="6"/><circle cx="30" cy="27" r="6"/><path d="m11 27 7-12 7 12H11l-4-15h-3m13 3h10l3 12M23 10h5"/></svg>',
        }),
        title: 'Rider position',
        alt: 'Rider position',
        zIndexOffset: 1000,
      }).addTo(map);
    }
  }, [distanceKm, routePoints, isFollowing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !polylineRef.current) return undefined;
    map.stop();
    if (!isFollowing) {
      map.fitBounds(polylineRef.current.getBounds(), { padding: [24, 24] });
      return undefined;
    }
    const start = positionAt(routePoints, distanceKmRef.current);
    map.setView([start.lat, start.lng], 16, { animate: false });
    const motion = createRouteMotion(distanceKmRef.current * 1000);
    let last = performance.now();
    let frame;
    const tick = now => {
      const distance = motion(distanceKmRef.current * 1000, telemetryRef.current?.speed, true, now, (now - last) / 1000);
      last = now;
      const p = positionAt(routePoints, distance / 1000);
      markerRef.current?.setLatLng([p.lat, p.lng]);
      map.panTo([p.lat, p.lng], { animate: false });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isFollowing, routePoints, distanceKmRef, telemetryRef]);

  return (
    <div ref={containerRef} className="leaflet-map" style={{ width: '100%', height: '100%' }} />
  );
}

// ── localStorage key for active route ─────────────────────────────────────────
const STORAGE_KEY = 'openride_current_route';

function loadSavedRoute() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RoutePage() {
  const { telemetry, setGrade, status } = useAnt();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [showDeviceModal, setShowDeviceModal] = useState(false);

  // Active route selected from the workout library
  const [routePoints, setRoutePoints] = useState(() => loadSavedRoute()?.points ?? []);
  const [routeName,   setRouteName]   = useState(() => loadSavedRoute()?.name   ?? '');
  const [routeId,     setRouteId]     = useState(() => loadSavedRoute()?.id     ?? null);

  const [routeError, setRouteError] = useState(null);

  // Ride state
  const [isRiding,      setIsRiding]      = useState(false);
  const [isPaused,      setIsPaused]      = useState(false);
  const [currentIndex,  setCurrentIndex]  = useState(0);
  const [liveStats,     setLiveStats]     = useState({ distanceRidden: 0, ele: 0, grade: 0, duration: 0 });

  // Map panel: 2D map or 3D first-person view
  const [viewMode, setViewMode] = useState('map'); // 'map' | '3d'

  // Completion summary
  const [showSummary,   setShowSummary]   = useState(false);
  const [summaryStats,  setSummaryStats]  = useState(null);
  // Full recording of the finished ride, for FIT / TCX export
  const [completedRide, setCompletedRide] = useState(null);

  // Refs for interval
  const telemetryRef       = useRef(telemetry);
  const distanceRiddenRef  = useRef(0);
  const lastGradeRef       = useRef(-999);
  const recorderRef        = useRef(null);
  if (!recorderRef.current) recorderRef.current = createRideRecorder();


  // Refs for detecting ride end
  const prevIsRidingRef = useRef(false);
  // Stable refs for route info (used in summary effect without being deps)
  const routePointsRef  = useRef(routePoints);
  const routeNameRef    = useRef(routeName);
  const routeIdRef      = useRef(routeId);

  // Keep telemetry refs current for interval
  useEffect(() => { telemetryRef.current = telemetry; }, [telemetry]);

  // Keep route info refs current
  useEffect(() => { routePointsRef.current = routePoints; }, [routePoints]);
  useEffect(() => { routeNameRef.current   = routeName;   }, [routeName]);
  useEffect(() => { routeIdRef.current     = routeId;     }, [routeId]);

  // Load a specific route requested via ?routeId= (e.g. from Training Program)
  useEffect(() => {
    const requestedId = searchParams.get('routeId');
    if (!requestedId) return;
    loadRoute(requestedId).then(entry => {
      if (!entry) { setRouteError('This route is no longer available. Choose a route from the workout list.'); setRoutePoints([]); return; }
      setRouteError(null);
      setRoutePoints(entry.points);
      setRouteName(entry.name);
      setRouteId(entry.id);
    }).catch(() => { setRouteError('Could not load this route. Try again from the workout list.'); setRoutePoints([]); });
  }, [searchParams]);

  // Persist active route to localStorage
  useEffect(() => {
    if (routePoints.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: routeId, name: routeName, points: routePoints }));
    } catch (_) {}
  }, [routePoints, routeName, routeId]);

  // Smoothed elevation profile: grade and climbing come from this rather than
  // from raw point-to-point GPX elevation, which is too noisy
  const routeProfile = useMemo(() => buildRouteProfile(routePoints), [routePoints]);
  const routeProfileRef = useRef(routeProfile);
  useEffect(() => { routeProfileRef.current = routeProfile; }, [routeProfile]);

  const routeStats = useMemo(() => {
    if (routePoints.length === 0) return null;
    const totalDistance = routePoints[routePoints.length - 1].distanceFromStart;
    let minEle = routePoints[0].ele;
    let maxEle = routePoints[0].ele;
    for (let i = 1; i < routePoints.length; i++) {
      if (routePoints[i].ele < minEle) minEle = routePoints[i].ele;
      if (routePoints[i].ele > maxEle) maxEle = routePoints[i].ele;
    }
    return { totalDistance, elevationGain: elevationGain(routeProfile), minEle, maxEle };
  }, [routePoints, routeProfile]);

  // ── Reset trainer grade on unmount ──────────────────────────────────────────
  useEffect(() => {
    return () => { setGrade(0).catch(() => {}); };
  }, [setGrade]);

  // ── Ride completion summary ───────────────────────────────────────────────────
  useEffect(() => {
    const wasRiding = prevIsRidingRef.current;
    prevIsRidingRef.current = isRiding;

    // Only trigger when ride transitions from active to stopped
    if (!wasRiding || isRiding) return;

    // Skip summary for trivial distances (< 100 m)
    if (distanceRiddenRef.current < 0.1) return;

    const name   = routeNameRef.current;
    const rid    = routeIdRef.current;
    const gainRidden = elevationGain(routeProfileRef.current, distanceRiddenRef.current);

    const recorder = recorderRef.current;
    recorder.stop();
    const metrics = computeRideMetrics(recorder.samples, readFtp());

    const stats = {
      routeName:       name,
      distance:        distanceRiddenRef.current,
      duration:        metrics.duration,
      elevationGain:   Math.round(gainRidden),
      avgPower:        metrics.avgPower,
      normalizedPower: metrics.normalizedPower,
      avgCadence:      metrics.avgCadence,
      avgHeartRate:    metrics.avgHeartRate,
      kilojoules:      metrics.kilojoules,
      tss:             metrics.tss,
    };

    // The history entry and the stored recording share an id so the ride can
    // be exported from the home page later
    const rideId = Date.now();
    const ride = {
      id:        rideId,
      type:      'route',
      name:      name || 'Route ride',
      startTime: new Date(recorder.startedAt).toISOString(),
      ftp:       readFtp(),
      samples:   recorder.samples,
      summary:   stats,
    };

    saveRouteRide({
      id:        rideId,
      routeId:   rid,
      routeName: name,
      date:      new Date().toISOString(),
      ...stats,
    });
    saveRideFile(ride).catch(err => console.error('Failed to store ride recording:', err));

    setCompletedRide(ride);
    setSummaryStats(stats);
    setShowSummary(true);
  }, [isRiding]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ride tracking ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isRiding || isPaused || routePoints.length === 0 || !routeStats) return;

    // Poll faster than 1 Hz; the recorder measures real elapsed time so a
    // throttled background tab does not slow the ride down.
    const interval = setInterval(() => {
      const recorder = recorderRef.current;
      const added = recorder.tick(telemetryRef.current);
      if (added === 0) return;

      // speed is km/h → km per second × seconds elapsed
      const previousDistance = distanceRiddenRef.current;
      const stepKm = telemetryRef.current.speed / 3600;
      distanceRiddenRef.current += stepKm * added;

      // Place each new second on the route, for map-based exports
      const samples = recorder.samples;
      for (let k = 0; k < added; k++) {
        const sample = samples[samples.length - added + k];
        const d = Math.min(previousDistance + stepKm * (k + 1), routeStats.totalDistance);
        const position = positionAt(routePoints, d);
        sample.routeDistance = d * 1000;
        sample.lat = position.lat;
        sample.lng = position.lng;
        sample.altitude = elevationAt(routeProfile, d);
      }

      const distanceRidden = distanceRiddenRef.current;

      let idx = 0;
      let low = 0;
      let high = routePoints.length - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (routePoints[mid].distanceFromStart <= distanceRidden) {
          idx = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      setCurrentIndex(idx);

      const gradeRounded = Math.round(gradeAt(routeProfile, distanceRidden) * 10) / 10;
      if (Math.abs(gradeRounded - lastGradeRef.current) >= 0.2) {
        lastGradeRef.current = gradeRounded;
        setGrade(gradeRounded).catch(() => {});
      }

      setLiveStats({
        distanceRidden,
        ele:      elevationAt(routeProfile, distanceRidden),
        grade:    gradeRounded,
        duration: recorder.elapsedSeconds,
      });

      if (distanceRidden >= routeStats.totalDistance) setIsRiding(false);
    }, 250);

    return () => clearInterval(interval);
  }, [isRiding, isPaused, routePoints, routeProfile, routeStats, setGrade]);

  const handleStartRide = useCallback(() => {
    distanceRiddenRef.current       = 0;
    lastGradeRef.current            = -999;
    recorderRef.current.start();
    setCurrentIndex(0);
    setIsPaused(false);
    setLiveStats({ distanceRidden: 0, ele: routePoints[0]?.ele ?? 0, grade: 0, duration: 0 });
    setIsRiding(true);
  }, [routePoints]);

  const handlePauseRide = useCallback(() => {
    recorderRef.current.pause();
    setIsPaused(true);
    setGrade(0).catch(() => {});
  }, [setGrade]);

  const handleResumeRide = useCallback(() => {
    lastGradeRef.current = -999;
    recorderRef.current.resume();
    setIsPaused(false);
  }, []);

  const handleStopRide = useCallback(() => {
    setIsPaused(false);
    setGrade(0).catch(() => {});
    setIsRiding(false); // triggers the summary useEffect
  }, [setGrade]);

  const handleRideAgain = useCallback(() => {
    setShowSummary(false);
    setSummaryStats(null);
    setCompletedRide(null);
    distanceRiddenRef.current       = 0;
    lastGradeRef.current            = -999;
    setCurrentIndex(0);
    setLiveStats({ distanceRidden: 0, ele: routePointsRef.current[0]?.ele ?? 0, grade: 0, duration: 0 });
  }, []);

  const gradeClass = useMemo(() => {
    if (liveStats.grade > 5) return 'grade-hard';
    if (liveStats.grade > 0) return 'grade-moderate';
    return 'grade-easy';
  }, [liveStats.grade]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="route-page">
      <TopBar variant="main" onDeviceScanClick={() => setShowDeviceModal(true)} />

      <main id="main-content" className="route-main">
        <div className="route-layout">

          {/* Sidebar */}
          <aside className="route-sidebar">
            <h1 className="route-heading">Route Ride</h1>

            <Link to="/?category=routes" className="route-workout-link">← Route workouts</Link>
            {routeError && <p className="route-error" role="alert">{routeError}</p>}
            {routePoints.length === 0 && <p className="route-empty-hint">Choose a route workout or upload a GPX from the workout list.</p>}

            {routeStats && (
              <>
                <div className="route-name-row">
                  <span className="route-name">{routeName}</span>
                </div>

                <div className="route-stats-grid">
                  <div className="route-stat">
                    <span className="route-stat-label">Distance</span>
                    <span className="route-stat-value">{routeStats.totalDistance.toFixed(1)} km</span>
                  </div>
                  <div className="route-stat">
                    <span className="route-stat-label">Elevation gain</span>
                    <span className="route-stat-value">+{Math.round(routeStats.elevationGain)} m</span>
                  </div>
                  <div className="route-stat">
                    <span className="route-stat-label">Min elevation</span>
                    <span className="route-stat-value">{Math.round(routeStats.minEle)} m</span>
                  </div>
                  <div className="route-stat">
                    <span className="route-stat-label">Max elevation</span>
                    <span className="route-stat-value">{Math.round(routeStats.maxEle)} m</span>
                  </div>
                </div>

                {isRiding && (
                  <div className="ride-live-stats">
                    <div className="ride-live-stat">
                      <span className="ride-live-label">Ridden</span>
                      <span className="ride-live-value">{liveStats.distanceRidden.toFixed(2)} km</span>
                    </div>
                    <div className="ride-live-stat">
                      <span className="ride-live-label">Time</span>
                      <span className="ride-live-value">{formatDuration(liveStats.duration)}</span>
                    </div>
                    <div className="ride-live-stat">
                      <span className="ride-live-label">Elevation</span>
                      <span className="ride-live-value">{Math.round(liveStats.ele)} m</span>
                    </div>
                    <div className="ride-live-stat">
                      <span className="ride-live-label">Grade</span>
                      <span className={`ride-live-value ${gradeClass}`}>
                        {liveStats.grade > 0 ? '+' : ''}{liveStats.grade}%
                      </span>
                    </div>
                  </div>
                )}

                <div className="route-controls">
                  {!isRiding ? (
                    <button
                      type="button"
                      className="btn-start-ride"
                      onClick={handleStartRide}
                      disabled={status !== 'connected'}
                      title={status !== 'connected' ? 'Connect a trainer first' : ''}
                    >
                      {status !== 'connected' ? 'Connect trainer to ride' : 'Start Ride'}
                    </button>
                  ) : (
                    <div className="ride-active-controls">
                      {isPaused ? (
                        <button type="button" className="btn-resume-ride" onClick={handleResumeRide}>
                          Resume
                        </button>
                      ) : (
                        <button type="button" className="btn-pause-ride" onClick={handlePauseRide}>
                          Pause
                        </button>
                      )}
                      <button type="button" className="btn-stop-ride" onClick={handleStopRide}>
                        Stop
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>

          {/* Map + elevation */}
          <section className="route-map-section" aria-label="Route map and elevation profile">
            {routeStats && <RideGauges telemetry={telemetry} ftp={readFtp()} />}
            <div className="map-wrapper">
              {routePoints.length === 0 ? (
                <div className="map-placeholder">
                  <svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/>
                  </svg>
                  <p>Choose a route workout from the workout list</p>
                </div>
              ) : (
                <>
                  <div className="map-view-toggle" role="tablist" aria-label="Route view">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={viewMode === 'map'}
                      className={viewMode === 'map' ? 'active' : ''}
                      onClick={() => setViewMode('map')}
                    >
                      Map
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={viewMode === '3d'}
                      className={viewMode === '3d' ? 'active' : ''}
                      onClick={() => setViewMode('3d')}
                    >
                      3D
                    </button>
                  </div>
                  <RouteErrorBoundary>
                    {viewMode === 'map' ? (
                      <RouteMap routePoints={routePoints} distanceKm={liveStats.distanceRidden} distanceKmRef={distanceRiddenRef} telemetryRef={telemetryRef} isFollowing={isRiding && !isPaused} />
                    ) : (
                      <Suspense fallback={<div className="route-3d-status">Loading 3D view…</div>}>
                        <Route3DView
                          routePoints={routePoints}
                          distanceKmRef={distanceRiddenRef}
                          telemetryRef={telemetryRef}
                          isRiding={isRiding && !isPaused}
                        />
                      </Suspense>
                    )}
                  </RouteErrorBoundary>
                </>
              )}
            </div>

            {routeStats && <NearbyPhotos routePoints={routePoints} distanceKm={liveStats.distanceRidden} />}
            {routeStats && (
              <div className="elevation-section">
                <div className="elevation-label">Elevation profile</div>
                <ElevationCanvas
                  routePoints={routePoints}
                  routeStats={routeStats}
                  currentIndex={currentIndex}
                  isRiding={isRiding}
                />
              </div>
            )}
          </section>

        </div>
      </main>

      <DeviceModal isOpen={showDeviceModal} onClose={() => setShowDeviceModal(false)} />

      {showSummary && summaryStats && (
        <div className="route-complete-overlay">
          <div className="route-complete-card">
            <div className="route-complete-header">
              <div className="route-complete-icon">✓</div>
              <div className="route-complete-title">Ride Complete</div>
              <div className="route-complete-name">{summaryStats.routeName || 'Route'}</div>
            </div>

            <div className="route-complete-stats">
              <div className="route-complete-stat">
                <div className="route-complete-stat-value">{formatDuration(summaryStats.duration)}</div>
                <div className="route-complete-stat-label">Duration</div>
              </div>
              <div className="route-complete-stat highlight">
                <div className="route-complete-stat-value">
                  {summaryStats.distance.toFixed(2)}
                  <span className="route-stat-unit">km</span>
                </div>
                <div className="route-complete-stat-label">Distance</div>
              </div>
              <div className="route-complete-stat">
                <div className="route-complete-stat-value">
                  +{summaryStats.elevationGain}
                  <span className="route-stat-unit">m</span>
                </div>
                <div className="route-complete-stat-label">Elevation gain</div>
              </div>
              {summaryStats.avgPower > 0 && (
                <div className="route-complete-stat">
                  <div className="route-complete-stat-value">
                    {summaryStats.avgPower}
                    <span className="route-stat-unit">W</span>
                  </div>
                  <div className="route-complete-stat-label">Avg power</div>
                </div>
              )}
              {summaryStats.avgCadence > 0 && (
                <div className="route-complete-stat">
                  <div className="route-complete-stat-value">
                    {summaryStats.avgCadence}
                    <span className="route-stat-unit">rpm</span>
                  </div>
                  <div className="route-complete-stat-label">Avg cadence</div>
                </div>
              )}
            </div>

            {completedRide && (
              <div className="route-complete-export">
                <span className="route-complete-export-label">Export ride</span>
                <button className="route-complete-btn secondary" onClick={() => downloadRide(completedRide, 'fit')}>.FIT</button>
                <button className="route-complete-btn secondary" onClick={() => downloadRide(completedRide, 'tcx')}>.TCX</button>
              </div>
            )}

            <div className="route-complete-actions">
              <button className="route-complete-btn secondary" onClick={() => navigate('/')}>
                Back to Home
              </button>
              <button className="route-complete-btn primary" onClick={handleRideAgain}>
                Ride Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
