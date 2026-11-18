// Real app shell, session context, route page, recorder and browser storage.
// Only the hardware boundary and network are replaced with deterministic fixtures.
import React, { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from '../../src/App.jsx';
import { AntContext } from '../../src/contexts/contextObjects.js';
import { RideSessionProvider, useRideSession } from '../../src/contexts/RideSessionContext.jsx';
import { saveRoute } from '../../src/services/routeLibrary.js';
import L from 'leaflet';
import { listRideFileIds, loadRideFile, deleteRideFiles } from '../../src/services/rideFiles.js';

// Avoid asynchronous map animations and external tile requests in this lifecycle test.
L.Map.mergeOptions({ zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
L.TileLayer.prototype.getTileUrl = () => 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const realNow = performance.now.bind(performance);
let clockOffset = 0;
performance.now = () => realNow() + clockOffset;
window.fetch = async input => {
  const url = String(input);
  if (url.includes('/api/status')) return Response.json({ emulator: true });
  if (url.includes('/api/workouts/categories')) return Response.json([]);
  if (url.includes('/api/workouts')) return Response.json([]);
  throw new Error(`Network disabled in lifecycle fixture: ${url}`);
};
const command = async () => {};
function TrainerFixture({ children }) {
  const [workoutActive, setWorkoutActive] = useState(false);
  return <AntContext.Provider value={{
    status: 'connected', trainerSignalFresh: true, connectedDevice: { deviceId: 12345 },
    telemetry: { power: 200, cadence: 85, speed: 30, heartRate: 130, distance: 0 },
    setGrade: command, setTargetPower: command, setResistance: command,
    workoutActive, setWorkoutActive, discoveredDevices: [],
  }}>{children}</AntContext.Provider>;
}
let state;
function Probe() {
  const { session } = useRideSession();
  const location = useLocation();
  const navigate = useNavigate();
  useLayoutEffect(() => { state = { session, location, navigate }; });
  return null;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(value, message) { if (!value) throw new Error(message); }
async function until(predicate, message) {
  const deadline = realNow() + 5000;
  while (!(await predicate())) {
    if (realNow() > deadline) throw new Error(message);
    await sleep(25);
  }
}
function click(selector, text) {
  const element = [...document.querySelectorAll(selector)].find(el => !text || el.textContent.trim() === text);
  check(element && !element.disabled, `Missing enabled control: ${selector} ${text || ''}`);
  element.click();
}
let root;
async function setup(distance = 1) {
  if (root) { root.unmount(); await sleep(0); }
  await deleteRideFiles([...(await listRideFileIds())]);
  localStorage.removeItem('openride_route_history');
  const points = [
    { lat: 51.75, lng: -1.25, ele: 60, distanceFromStart: 0 },
    { lat: 51.751, lng: -1.249, ele: 60, distanceFromStart: distance },
  ];
  const route = { id: 'first', name: 'Lifecycle fixture', points, totalDistance: distance };
  localStorage.setItem('openride_current_route', JSON.stringify(route));
  await saveRoute({ ...route, id: 'second', name: 'Second ride' });
  root = createRoot(document.getElementById('root'));
  root.render(<MemoryRouter initialEntries={['/route']}><TrainerFixture><RideSessionProvider><Probe /><AppShell /></RideSessionProvider></TrainerFixture></MemoryRouter>);
  await until(() => document.querySelector('.btn-start-ride'), 'Route did not mount');
  click('.btn-start-ride');
  await until(() => state.session && document.querySelector('.btn-stop-ride'), 'Ride did not start');
}
async function advance(seconds) {
  clockOffset += seconds * 1000;
  await sleep(350); // Let the real route interval sample the advanced recorder clock.
}
async function openNewRide() {
  state.navigate('/route?routeId=second');
  await until(() => document.querySelector('.session-conflict') || document.querySelector('.route-name')?.textContent === 'Second ride', 'New ride did not render');
  check(!document.querySelector('.session-conflict'), 'Completed ride blocks starting a different ride');
  check(document.querySelector('.btn-start-ride'), 'New ride has no start control');
  click('.btn-start-ride');
  await until(() => state.session?.path === '/route?routeId=second', 'New ride did not start');
}
window.runLifecycleScenario = async scenario => {
  await setup(scenario === 'automatic completion' ? 0.12 : 1);
  if (scenario === 'navigate while riding') {
    await advance(2);
    state.navigate('/');
    await until(() => state.location.pathname === '/', 'Did not navigate home');
    check(state.session && !state.session.complete, 'Navigation ended an unfinished ride');
    check(document.querySelector('.active-session-bar'), 'Active ride banner missing');
    await advance(2);
    check(state.session.elapsed >= 4, 'Hidden ride stopped recording');
    state.navigate('/route?routeId=second');
    await until(() => document.querySelector('.session-conflict'), 'Unfinished ride was not protected');
    click('.session-conflict a');
    await until(() => document.querySelector('.session-page:not([hidden]) .btn-stop-ride'), 'Return to ride failed');
    click('.btn-pause-ride');
    await until(() => state.session.paused, 'Pause did not update session');
    state.navigate('/');
    await until(() => state.location.pathname === '/', 'Paused ride did not navigate');
    check(state.session.paused && !state.session.complete, 'Navigation discarded paused ride');
    return;
  }
  if (scenario === 'short ride discard') {
    click('.btn-stop-ride');
    await until(() => state.session === null, 'Short stopped ride retained a session');
    check(!document.querySelector('.route-complete-overlay'), 'Short discarded ride has summary');
    check((await listRideFileIds()).size === 0, 'Short discarded ride was saved');
    state.navigate('/');
    await sleep(50);
    await openNewRide();
    return;
  }
  await advance(20);
  if (scenario !== 'automatic completion') click('.btn-stop-ride');
  await until(() => document.querySelector('.route-complete-overlay'), 'Ride summary missing');
  check(state.session.complete, 'Stopped ride not marked complete');
  await until(() => JSON.parse(localStorage.getItem('openride_route_history') || '[]').length === 1, 'History not saved');
  const history = JSON.parse(localStorage.getItem('openride_route_history'));
  await until(async () => (await listRideFileIds()).size === 1, 'Recording not saved');
  const ids = await listRideFileIds();
  check(ids.size === 1 && ids.has(history[0].id), 'Recording was not saved with history id');
  const ride = await loadRideFile(history[0].id);
  check(ride.samples.length > 0 && ride.type === 'route', 'Saved route has no recording');
  if (scenario === 'ride again') {
    click('.route-complete-actions button', 'Ride Again');
    await until(() => state.session === null, 'Ride Again retained completed session');
    check(!document.querySelector('.route-complete-overlay'), 'Ride Again retained summary');
    click('.btn-start-ride');
    await until(() => state.session && !state.session.complete, 'Ride Again could not start');
    return;
  }
  click('.route-complete-actions button', 'Back to Home');
  await until(() => state.location.pathname === '/', 'Back to Home did not navigate');
  check(state.session === null, 'Back to Home retained the completed ride session');
  check(!document.querySelector('.active-session-bar'), 'Home still shows a ride banner');
  check((await listRideFileIds()).size === 1, 'Leaving summary deleted saved recording');
  await openNewRide();
};
window.lifecycleReady = true;
