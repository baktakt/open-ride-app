import { routeSpeedKmh } from '../services/cyclingPhysics';
import { useRideSession } from '../contexts/RideSessionContext';
import { startTrainerControl } from '../services/trainerControl';
import { routeTrainingTarget, routeTrainingProfile } from '../services/routeTraining';
import React, { Component, Suspense, lazy, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import L from 'leaflet';
import { placeMarkerSvg, groupPhotoMarkers } from '../services/routeMapIcons';
import { useAnt } from '../contexts/AntContext';
import TopBar from '../components/TopBar';
import DeviceModal from '../components/DeviceModal';
import RideGauges from '../components/RideGauges';
import { importPublicRoute } from '../services/publicRoutes';
import NearbyPhotos from '../components/NearbyPhotos';
import { useTourGuide, TourGuideControls, TourGuideSubtitles, TourGuideProgress } from '../components/TourGuide';
import { loadRoute } from '../services/routeLibrary';
import { saveRouteRide } from '../services/dataManager';
import { createRideRecorder } from '../services/rideRecorder';
import { computeRideMetrics } from '../services/rideMetrics';
import { buildRouteProfile, gradeAt, elevationAt, elevationGain, positionAt } from '../services/routeProfile';
import { saveRideFile } from '../services/rideFiles';
import { downloadRide } from '../services/rideExport';
import { createRouteMotion } from '../services/routeMotion';
import { groupGuideStops } from '../services/tourGuide';
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

function RouteMap({ routePoints, distanceKm, distanceKmRef, telemetryRef, isFollowing, tourStops, photoPlaces }) {
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
    if (!map) return undefined;
    const layer = L.layerGroup().addTo(map);
    const addMarker = (lat, lng, title, type, status = 'upcoming', count = 1) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const label = document.createElement('span');
      label.textContent = title;
      L.marker([lat, lng], {
        title, alt: title, zIndexOffset: type === 'guide' ? 400 : 200,
        icon: L.divIcon({
          className: `route-place-marker route-place-marker--${type} route-place-marker--${status}`,
          iconSize: [36, 44], iconAnchor: [18, 42], tooltipAnchor: [0, -38],
          html: placeMarkerSvg(type, count),
        }),
      }).bindTooltip(label, { direction: 'top' }).addTo(layer);
    };
    const refresh = () => {
      layer.clearLayers();
      for (const stop of tourStops) addMarker(stop.lat, stop.lng, `Tour guide: ${stop.label} · ${stop.status}`, 'guide', stop.status);
      const groups = groupPhotoMarkers(photoPlaces, (lat, lng) => map.latLngToContainerPoint([lat, lng]));
      for (const group of groups) addMarker(group.lat, group.lng, `Photos: ${group.places.map(place => place.name).join(' · ')}`, 'photo', 'upcoming', group.places.length);
    };
    refresh();
    map.on('zoomend', refresh);
    return () => { map.off('zoomend', refresh); layer.remove(); };
  }, [tourStops, photoPlaces]);

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

export default function RoutePage({ isVisible = true }) {
  const location = useLocation();
  const { startSession, updateSession, endSession } = useRideSession();
  const { telemetry, trainerSignalFresh, setGrade, setTargetPower, setResistance, status, connectedDevice, setWorkoutActive } = useAnt();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [showDeviceModal, setShowDeviceModal] = useState(false);

  // Active route selected from the workout library
  const [routePoints, setRoutePoints] = useState(() => loadSavedRoute()?.points ?? []);
  const [routeName,   setRouteName]   = useState(() => loadSavedRoute()?.name   ?? '');
  const [routeId,     setRouteId]     = useState(() => loadSavedRoute()?.id     ?? null);

  const [publicLoading, setPublicLoading] = useState('');
  const [publicInfo, setPublicInfo] = useState(() => { const saved = loadSavedRoute(); const requested = searchParams.get('routeId'); return !searchParams.has('publicRoute') && (!requested || requested === saved?.id) && saved?.curated ? saved : null; });
  const [routeError, setRouteError] = useState(null);
  const [photoPlaces, setPhotoPlaces] = useState([]);

  // Ride state
  const [isRiding,      setIsRiding]      = useState(false);
  const [isPaused,      setIsPaused]      = useState(false);
  const [currentIndex,  setCurrentIndex]  = useState(0);
  const [liveStats,     setLiveStats]     = useState({ distanceRidden: 0, ele: 0, grade: 0, duration: 0 });

  // Map panel: 2D map or 3D first-person view
  const guide = useTourGuide({ route: publicInfo, distanceKm: liveStats.distanceRidden, isRiding, isPaused });
  const guideMarkers = useMemo(() => groupGuideStops(guide.stops), [guide.stops]);
  const [rideMode, setRideMode] = useState('training');
  const [trainerNotice, setTrainerNotice] = useState('');
  const hadControlRef = useRef(false);
  const target = routeTrainingTarget(liveStats.distanceRidden, routePoints.at(-1)?.distanceFromStart || 0, readFtp());
  const [viewMode, setViewMode] = useState('map'); // 'map' | '3d'

  // Completion summary
  const [showSummary,   setShowSummary]   = useState(false);
  const [summaryStats,  setSummaryStats]  = useState(null);
  // Full recording of the finished ride, for FIT / TCX export
  const [completedRide, setCompletedRide] = useState(null);

  // Refs for interval
  const telemetryRef       = useRef(telemetry);
  const distanceRiddenRef  = useRef(0);
  const recorderRef        = useRef(null);
  if (!recorderRef.current) recorderRef.current = createRideRecorder();


  // Refs for detecting ride end
  const prevIsRidingRef = useRef(false);
  // Stable refs for route info (used in summary effect without being deps)
  const routePointsRef  = useRef(routePoints);
  const routeNameRef    = useRef(routeName);
  const routeIdRef      = useRef(routeId);

  const [mass] = useState(() => {
    try {
      const settings = JSON.parse(localStorage.getItem('openride_settings') || '{}');
      return (Number(settings.weight) || 75) + (Number(settings.bikeWeight) || 8);
    } catch { return 83; }
  });
  const movingSpeed = routeSpeedKmh(telemetry, liveStats.grade, mass, trainerSignalFresh && status === 'connected' && isRiding && !isPaused);
  // One speed drives the gauge, recorded samples, distance and both map cameras.
  useEffect(() => { telemetryRef.current = { ...telemetry, speed: movingSpeed }; }, [telemetry, movingSpeed]);

  // Keep route info refs current
  useEffect(() => { routePointsRef.current = routePoints; }, [routePoints]);
  useEffect(() => { routeNameRef.current   = routeName;   }, [routeName]);
  useEffect(() => { routeIdRef.current     = routeId;     }, [routeId]);

  useEffect(() => {
    const id = searchParams.get('publicRoute');
    if (!id) return;
    const controller = new AbortController();
    setPublicInfo(null); setRoutePoints([]); setRouteError(null); setPublicLoading('Loading public route…');
    importPublicRoute(id, { apiBase: import.meta.env.VITE_API_BASE_URL || '', signal: controller.signal, onProgress: setPublicLoading }).then(route => {
      if (controller.signal.aborted) return;
      setRoutePoints(route.points); setRouteName(route.name); setRouteId(route.id); setPublicInfo(route); setPublicLoading('');
    }).catch(error => { if (!controller.signal.aborted) { setRouteError(error.message); setPublicLoading(''); } });
    return () => controller.abort();
  }, [searchParams]);

  // Load a specific route requested via ?routeId= (e.g. from Training Program)
  useEffect(() => {
    const requestedId = searchParams.get('routeId');
    if (!requestedId || searchParams.get('publicRoute')) return;
    loadRoute(requestedId).then(entry => {
      if (!entry) { setRouteError('This route is no longer available. Choose a route from the workout list.'); setRoutePoints([]); return; }
      setRouteError(null);
      setPublicInfo(entry.curated ? entry : null);
      if (entry.publicSource) {
        importPublicRoute(entry.publicSource, { apiBase: import.meta.env.VITE_API_BASE_URL || '' }).then(setPublicInfo).catch(() => {});
      }
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: routeId, name: routeName, points: routePoints, ...(publicInfo?.curated ? { curated: true, guide: publicInfo.guide, publicSource: publicInfo.publicSource, routeHash: publicInfo.routeHash } : {}) }));
    } catch (_) {}
  }, [routePoints, routeName, routeId, publicInfo]);

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

  // Release trainer control when the activity is removed.
  useEffect(() => {
    return () => { setResistance(0).catch(() => {}); };
  }, [setResistance]);

  // ── Ride completion summary ───────────────────────────────────────────────────
  useEffect(() => {
    const wasRiding = prevIsRidingRef.current;
    prevIsRidingRef.current = isRiding;

    // Only trigger when ride transitions from active to stopped
    if (!wasRiding || isRiding) return;

    const recorder = recorderRef.current;
    recorder.stop();
    // A very short test ride has no saved summary to return to.
    if (distanceRiddenRef.current < 0.1) { endSession(); return; }

    updateSession({ complete: true });
    const name   = routeNameRef.current;
    const rid    = routeIdRef.current;
    const gainRidden = elevationGain(routeProfileRef.current, distanceRiddenRef.current);

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

  useEffect(() => {
    setWorkoutActive(isRiding);
    return () => setWorkoutActive(false);
  }, [isRiding, setWorkoutActive]);

  useEffect(() => {
    if (isRiding) updateSession({ elapsed: liveStats.duration, paused: isPaused });
  }, [isRiding, liveStats.duration, isPaused, updateSession]);

  // Commands are independent of telemetry sampling: the first target is sent
  // immediately, and restored after a reconnect or resume.
  const commandValue = rideMode === 'training' ? target.watts : Math.round(gradeAt(routeProfile, liveStats.distanceRidden) * 10) / 10;
  // Read the latest target on each send; a ramp must not start overlapping writes.
  const controlTarget = useRef(null);
  controlTarget.current = { mode: rideMode, value: commandValue };
  useEffect(() => {
    if (!isRiding || isPaused) {
      setTrainerNotice('');
      if (hadControlRef.current) { hadControlRef.current = false; setResistance(0).catch(() => {}); }
      return;
    }
    if (status !== 'connected') return;
    hadControlRef.current = true;
    return startTrainerControl({
      send: () => controlTarget.current.mode === 'training' ? setTargetPower(controlTarget.current.value) : setGrade(controlTarget.current.value),
      onError: setTrainerNotice,
    });
  }, [isRiding, isPaused, status, connectedDevice?.deviceId, setTargetPower, setGrade, setResistance]);

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
      distanceRiddenRef.current = Math.min(routeStats.totalDistance, previousDistance + stepKm * added);

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

  const handleStartRide = useCallback(async () => {
    if (guide.mode === 'prepared') await guide.enableSaved();
    distanceRiddenRef.current       = 0;
    startSession({ location, name: routeName, kind: 'route' });
    recorderRef.current.start();
    setCurrentIndex(0);
    setIsPaused(false);
    setLiveStats({ distanceRidden: 0, ele: routePoints[0]?.ele ?? 0, grade: 0, duration: 0 });
    setIsRiding(true);
  }, [routePoints, guide.mode, guide.enableSaved, startSession, location, routeName]);

  const handlePauseRide = useCallback(() => {
    recorderRef.current.pause();
    setIsPaused(true);
    setResistance(0).catch(() => {});
  }, [setResistance]);

  const handleResumeRide = useCallback(() => {
    recorderRef.current.resume();
    setIsPaused(false);
  }, []);

  const handleStopRide = useCallback(() => {
    setIsPaused(false);
    setResistance(0).catch(() => {});
    setIsRiding(false); // triggers the summary useEffect
  }, [setResistance]);

  const handleRideAgain = useCallback(() => {
    endSession();
    setShowSummary(false);
    setSummaryStats(null);
    setCompletedRide(null);
    distanceRiddenRef.current       = 0;
    setCurrentIndex(0);
    setLiveStats({ distanceRidden: 0, ele: routePointsRef.current[0]?.ele ?? 0, grade: 0, duration: 0 });
  }, [endSession]);

  const gradeClass = useMemo(() => {
    if (liveStats.grade > 5) return 'grade-hard';
    if (liveStats.grade > 0) return 'grade-moderate';
    return 'grade-easy';
  }, [liveStats.grade]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={`route-page${isRiding ? ' is-riding' : ''}`}>
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

                {publicInfo?.curated && <details className="public-route-context"><summary>About this route · ~{publicInfo.estimatedMinutes} min</summary><p>{publicInfo.paceNote || 'Curated indoor ride · time depends on pace'}</p>{publicInfo.contentNote && <p>{publicInfo.contentNote}</p>}<small>{publicInfo.attribution || 'Open Ride curated collection'}</small><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Map data credits</a></details>}
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
                  {!isRiding && <div className="route-training-setup">
                    <label htmlFor="route-ride-mode">Ride workout</label>
                    <select id="route-ride-mode" value={rideMode} onChange={event => setRideMode(event.target.value)}>
                      <option value="training">Automatic endurance workout</option>
                      <option value="terrain">Follow the route’s hills</option>
                    </select>
                    <p>{rideMode === 'training' ? `Automatic resistance based on your ${readFtp()} W FTP. Flat roads still have a workload.` : 'Resistance follows the route elevation. Flat roads are easier.'}</p>
                    {rideMode === 'training' && <div className="route-training-profile" role="img" aria-label="Warm-up, endurance and tempo efforts with recoveries, then cooldown">{routeTrainingProfile().map(block => <span key={block.end} style={{ flex: block.end - block.start, height: `${Math.max(block.from, block.to) * 40}px` }} title={`${block.name}: ${Math.round(block.from * 100)}–${Math.round(block.to * 100)}% FTP`} />)}</div>}
                  </div>}
                  {isRiding && rideMode === 'training' && <p className="route-target-label">{target.name} · Target {target.watts} W ({target.percent}% FTP)</p>}
                  {isRiding && status !== 'connected' && <p role="status" className="route-control-notice">Trainer connection lost. Your ride is still open. Use Connect Devices if the trainer doesn’t return.</p>}
                  {isRiding && !isPaused && status === 'connected' && trainerNotice && <p role="status" className="route-control-notice">{trainerNotice}</p>}
                  <TourGuideControls guide={guide} />
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
            {routeStats && <RideGauges telemetry={{ ...telemetry, speed: movingSpeed }} ftp={readFtp()} targetPower={isRiding && !isPaused && rideMode === 'training' ? target.watts : 0} />}
            <div className="map-wrapper">
              {routePoints.length === 0 ? (
                <div className="map-placeholder">
                  <svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/>
                  </svg>
                  <p>{publicLoading || routeError || 'Choose a route workout from the workout list'}</p>
                </div>
              ) : (
                <>
                  <TourGuideProgress guide={guide} />
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
                    {!isVisible ? null : viewMode === 'map' ? (
                      <RouteMap routePoints={routePoints} distanceKm={liveStats.distanceRidden} distanceKmRef={distanceRiddenRef} telemetryRef={telemetryRef} isFollowing={isRiding && !isPaused} tourStops={guideMarkers} photoPlaces={photoPlaces} />
                    ) : (
                      <Suspense fallback={<div className="route-3d-status">Loading 3D view…</div>}>
                        <Route3DView
                          routePoints={routePoints}
                          distanceKmRef={distanceRiddenRef}
                          telemetryRef={telemetryRef}
                          isRiding={isRiding && !isPaused}
                          tourStops={guideMarkers}
                        />
                      </Suspense>
                    )}
                  </RouteErrorBoundary>
                  <TourGuideSubtitles guide={guide} />
                  {viewMode === 'map' && (guide.stops.length > 0 || photoPlaces.length > 0) && <div className="route-marker-legend">
                    {guide.stops.length > 0 && <span><i />Guide stops</span>}
                    {photoPlaces.length > 0 && <span><i className="photo-dot" />Photos</span>}
                  </div>}
                </>
              )}
            </div>

            {routeStats && <NearbyPhotos guide={guide} routePoints={routePoints} distanceKm={liveStats.distanceRidden} onPlacesChange={setPhotoPlaces} />}
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
