import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import WorkoutPage from '../../src/pages/WorkoutPage.jsx';
import { AntContext } from '../../src/contexts/contextObjects.js';
import { RideSessionProvider } from '../../src/contexts/RideSessionContext.jsx';
import '../../src/styles/index.css';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let acknowledge = false;
let failuresAllowed = false;
const send = async () => !failuresAllowed || acknowledge;
const realTimeout = window.setTimeout;
window.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms === 2000 || ms === 4000 ? 20 : ms, ...args);
localStorage.setItem('openride_settings', JSON.stringify({ ftp: 200, countdownDuration: 1 }));
window.fetch = async () => Response.json({ id: 'feedback', name: 'Feedback fixture', elements: [{ type: 'SteadyState', duration: 300, power: 0.7 }] });
let setConnection;
function Fixture() {
  const [status, update] = useState('connected');
  setConnection = update;
  return <AntContext.Provider value={{ status, connectedDevice: { deviceId: 123 },
    telemetry: { power: 140, cadence: 85 }, setTargetPower: send, setResistance: send,
    setWorkoutActive() {}, discoveredDevices: [],
  }}><RideSessionProvider><Routes><Route path="/workout/:id" element={<WorkoutPage />} /></Routes></RideSessionProvider></AntContext.Provider>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/workout/feedback']}><Fixture /></MemoryRouter>);
async function until(fn, label) {
  for (let i = 0; i < 300; i++) { if (fn()) return; await sleep(10); }
  throw new Error(`Timed out: ${label}`);
}
const check = (ok, message) => { if (!ok) throw new Error(message); };
window.runFeedback = async () => {
  await until(() => document.querySelector('.btn-large'), 'preview');
  document.querySelector('.btn-large').click();
  await until(() => document.querySelector('.workout-main') && !document.querySelector('.countdown-overlay'), 'ride start');
  const top = () => document.querySelector('.workout-main').getBoundingClientRect().top;
  const before = top();
  failuresAllowed = true;
  await until(() => document.querySelector('.trainer-control-notice'), 'real repeated command failure warning');
  check(top() === before, `Warning shifted workout from ${before} to ${top()}`);
  acknowledge = true;
  await until(() => !document.querySelector('.trainer-control-notice'), 'ACK clears warning');
  check(top() === before, 'Warning recovery shifted workout');
  setConnection('disconnected');
  await until(() => document.querySelector('.trainer-control-notice')?.textContent.includes('connection lost'), 'connection loss warning');
  check(top() === before, 'Connection warning shifted workout');
  setConnection('connected');
  await until(() => !document.querySelector('.trainer-control-notice'), 'reconnection clears warning');
  return { before, after: top(), ok: true };
};
window.feedbackReady = true;
