import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import DeviceModal from '../components/DeviceModal';
import { loadAiSettings, saveAiSettings } from '../services/aiWorkoutGenerator';
import { downloadExport, importFromFile, loadCustomWorkouts } from '../services/dataManager';
import '../styles/settings.css';
import '../styles/legal.css';

const DEFAULT_SETTINGS = {
  ftp: 200,
  maxHr: 185,
  restingHr: 60,
  weight: 70,
  bikeWeight: 8,
  wheelCircumference: 2105,
  units: 'metric',
  autoConnect: false,
  soundEffects: true,
  countdownDuration: 3,
  lastDeviceId: null
};

const STORAGE_KEY = 'openride_settings';

const loadSettings = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
};

const saveSettingsToStorage = (settings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.error('Failed to save settings:', error);
    return false;
  }
};

const convertWeight = (valueInKg, units) => {
  if (units === 'imperial') {
    return (valueInKg * 2.20462).toFixed(1);
  }
  return valueInKg.toString();
};

const convertWeightToKg = (value, units) => {
  if (units === 'imperial') {
    return value / 2.20462;
  }
  return value;
};

export default function SettingsPage() {
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [useEmulator, setUseEmulator] = useState(false);
  const [aiSettings, setAiSettings] = useState(() => loadAiSettings());
  const [showApiKey, setShowApiKey] = useState(false);
  const [importStatus, setImportStatus] = useState(null); // null | 'success' | 'error'
  const [importMessage, setImportMessage] = useState('');
  const [form, setForm] = useState(() => {
    const settings = loadSettings();
    return {
      ...settings,
      weight: convertWeight(settings.weight, settings.units),
      bikeWeight: convertWeight(settings.bikeWeight, settings.units)
    };
  });

  useEffect(() => {
    const emulatorSetting = localStorage.getItem('openride_use_emulator');
    setUseEmulator(emulatorSetting === 'true');
  }, []);

  useEffect(() => {
    if (!showToast) return;
    const timer = setTimeout(() => setShowToast(false), 3000);
    return () => clearTimeout(timer);
  }, [showToast]);

  const zoneRanges = useMemo(() => {
    const ftp = Number(form.ftp) || DEFAULT_SETTINGS.ftp;
    return {
      zone1: `< ${Math.round(ftp * 0.6)}W`,
      zone2: `${Math.round(ftp * 0.6)} - ${Math.round(ftp * 0.75)}W`,
      zone3: `${Math.round(ftp * 0.76)} - ${Math.round(ftp * 0.89)}W`,
      zone4: `${Math.round(ftp * 0.9)} - ${Math.round(ftp * 1.04)}W`,
      zone5: `${Math.round(ftp * 1.05)} - ${Math.round(ftp * 1.18)}W`,
      zone6: `> ${Math.round(ftp * 1.18)}W`
    };
  }, [form.ftp]);

  const handleUnitsChange = (value) => {
    if (value === form.units) return;
    const weight = parseFloat(form.weight) || DEFAULT_SETTINGS.weight;
    const bikeWeight = parseFloat(form.bikeWeight) || DEFAULT_SETTINGS.bikeWeight;
    const convertedWeight = value === 'imperial'
      ? (weight * 2.20462).toFixed(1)
      : (weight / 2.20462).toFixed(1);
    const convertedBikeWeight = value === 'imperial'
      ? (bikeWeight * 2.20462).toFixed(1)
      : (bikeWeight / 2.20462).toFixed(1);

    setForm(prev => ({
      ...prev,
      units: value,
      weight: convertedWeight,
      bikeWeight: convertedBikeWeight
    }));
  };

  const handleSave = () => {
    const settingsToSave = {
      ...form,
      ftp: parseInt(form.ftp, 10) || DEFAULT_SETTINGS.ftp,
      maxHr: parseInt(form.maxHr, 10) || DEFAULT_SETTINGS.maxHr,
      restingHr: parseInt(form.restingHr, 10) || DEFAULT_SETTINGS.restingHr,
      weight: convertWeightToKg(parseFloat(form.weight) || DEFAULT_SETTINGS.weight, form.units),
      bikeWeight: convertWeightToKg(parseFloat(form.bikeWeight) || DEFAULT_SETTINGS.bikeWeight, form.units),
      wheelCircumference: parseInt(form.wheelCircumference, 10) || DEFAULT_SETTINGS.wheelCircumference,
      countdownDuration: parseInt(form.countdownDuration, 10) || DEFAULT_SETTINGS.countdownDuration
    };

    if (saveSettingsToStorage(settingsToSave)) {
      saveAiSettings(aiSettings);
      setShowToast(true);
    }
  };

  const handleReset = () => {
    if (!window.confirm('Are you sure you want to reset all settings to their default values?')) return;
    localStorage.removeItem(STORAGE_KEY);
    const defaults = { ...DEFAULT_SETTINGS };
    setForm({
      ...defaults,
      weight: convertWeight(defaults.weight, defaults.units),
      bikeWeight: convertWeight(defaults.bikeWeight, defaults.units)
    });
  };

  const handleEmulatorToggle = () => {
    const nextValue = !useEmulator;
    setUseEmulator(nextValue);
    localStorage.setItem('openride_use_emulator', nextValue ? 'true' : 'false');
  };

  return (
    <div>
      <TopBar showConnection={false} onDeviceScanClick={() => setIsDeviceModalOpen(true)} />

      <main className="main-content">
        <div className="content-wrapper settings-wrapper">
          <section className="settings-header">
            <h1>Settings</h1>
            <p className="settings-subtitle">Configure your training profile and preferences</p>
          </section>

          <div className="settings-container">
            <section className="settings-section">
              <div className="section-title">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
                <h2>Athlete Profile</h2>
              </div>

              <div className="settings-card">
                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="ftp">Functional Threshold Power (FTP)</label>
                    <p className="setting-description">Your maximum sustainable power for one hour. Used to calculate workout intensities.</p>
                  </div>
                  <div className="setting-input">
                    <input
                      type="number"
                      id="ftp"
                      min="50"
                      max="500"
                      step="1"
                      value={form.ftp}
                      onChange={(e) => setForm(prev => ({ ...prev, ftp: e.target.value }))}
                    />
                    <span className="input-unit">watts</span>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="max-hr">Maximum Heart Rate</label>
                    <p className="setting-description">Your maximum heart rate for HR zone calculations.</p>
                  </div>
                  <div className="setting-input">
                    <input
                      type="number"
                      id="max-hr"
                      min="100"
                      max="220"
                      step="1"
                      value={form.maxHr}
                      onChange={(e) => setForm(prev => ({ ...prev, maxHr: e.target.value }))}
                    />
                    <span className="input-unit">bpm</span>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="weight">Body Weight</label>
                    <p className="setting-description">Used for power-to-weight calculations and calorie estimates.</p>
                  </div>
                  <div className="setting-input">
                    <input
                      type="number"
                      id="weight"
                      min="30"
                      max="200"
                      step="0.1"
                      value={form.weight}
                      onChange={(e) => setForm(prev => ({ ...prev, weight: e.target.value }))}
                    />
                    <span className="input-unit" id="weight-unit">{form.units === 'imperial' ? 'lb' : 'kg'}</span>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="resting-hr">Resting Heart Rate</label>
                    <p className="setting-description">Your heart rate at complete rest. Used for HR reserve calculations.</p>
                  </div>
                  <div className="setting-input">
                    <input
                      type="number"
                      id="resting-hr"
                      min="30"
                      max="100"
                      step="1"
                      value={form.restingHr}
                      onChange={(e) => setForm(prev => ({ ...prev, restingHr: e.target.value }))}
                    />
                    <span className="input-unit">bpm</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm5.8-10l2.4-2.4.8.8c1.3 1.3 3 2.1 5.1 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.5-.4-1-.6-1.6-.6s-1.1.2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6.2l-2.2-2.3zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5z"/>
                </svg>
                <h2>Equipment</h2>
              </div>

              <div className="settings-card">
                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="bike-weight">Bike Weight</label>
                    <p className="setting-description">Weight of your bike for more accurate simulations.</p>
                  </div>
                  <div className="setting-input">
                    <input
                      type="number"
                      id="bike-weight"
                      min="5"
                      max="20"
                      step="0.1"
                      value={form.bikeWeight}
                      onChange={(e) => setForm(prev => ({ ...prev, bikeWeight: e.target.value }))}
                    />
                    <span className="input-unit" id="bike-weight-unit">{form.units === 'imperial' ? 'lb' : 'kg'}</span>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="wheel-circumference">Wheel Circumference</label>
                    <p className="setting-description">For accurate speed and distance calculations. Common: 700x25c = 2105mm</p>
                  </div>
                  <div className="setting-input">
                    <input
                      type="number"
                      id="wheel-circumference"
                      min="1500"
                      max="2500"
                      step="1"
                      value={form.wheelCircumference}
                      onChange={(e) => setForm(prev => ({ ...prev, wheelCircumference: e.target.value }))}
                    />
                    <span className="input-unit">mm</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 6h16v12H4zM8 9h8v2H8zm0 4h5v2H8z"/>
                </svg>
                <h2>Device Settings</h2>
              </div>

              <div className="settings-card">
                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="emulator-mode">Emulator Mode</label>
                    <p className="setting-description">Use simulated trainers instead of real hardware.</p>
                  </div>
                  <div className="setting-input">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        id="emulator-mode"
                        checked={useEmulator}
                        onChange={handleEmulatorToggle}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-info">
                    <label>Reload Required</label>
                    <p className="setting-description">Reload the page after toggling emulator mode.</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
                </svg>
                <h2>Preferences</h2>
              </div>

              <div className="settings-card">
                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="units">Unit System</label>
                    <p className="setting-description">Choose between metric and imperial units.</p>
                  </div>
                  <div className="setting-input">
                    <select id="units" value={form.units} onChange={(e) => handleUnitsChange(e.target.value)}>
                      <option value="metric">Metric (kg, km)</option>
                      <option value="imperial">Imperial (lb, mi)</option>
                    </select>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="auto-connect">Auto-connect to Last Device</label>
                    <p className="setting-description">Automatically connect to the last used trainer on startup.</p>
                  </div>
                  <div className="setting-input">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        id="auto-connect"
                        checked={form.autoConnect}
                        onChange={(e) => setForm(prev => ({ ...prev, autoConnect: e.target.checked }))}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="sound-effects">Sound Effects</label>
                    <p className="setting-description">Play audio cues during workouts (intervals, achievements).</p>
                  </div>
                  <div className="setting-input">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        id="sound-effects"
                        checked={form.soundEffects}
                        onChange={(e) => setForm(prev => ({ ...prev, soundEffects: e.target.checked }))}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="countdown-duration">Workout Countdown</label>
                    <p className="setting-description">Duration of countdown before workout starts.</p>
                  </div>
                  <div className="setting-input">
                    <select
                      id="countdown-duration"
                      value={form.countdownDuration}
                      onChange={(e) => setForm(prev => ({ ...prev, countdownDuration: e.target.value }))}
                    >
                      <option value="3">3 seconds</option>
                      <option value="5">5 seconds</option>
                      <option value="10">10 seconds</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
                </svg>
                <h2>AI Workout Generator</h2>
              </div>

              <div className="settings-card">
                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="ai-provider">AI Provider</label>
                    <p className="setting-description">Which LLM provider to use for generating workouts.</p>
                  </div>
                  <div className="setting-input">
                    <select
                      id="ai-provider"
                      value={aiSettings.provider}
                      onChange={(e) => setAiSettings(prev => ({ ...prev, provider: e.target.value }))}
                    >
                      <option value="openai">OpenAI (GPT-4o mini)</option>
                      <option value="anthropic">Anthropic (Claude Haiku)</option>
                    </select>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <label htmlFor="ai-api-key">API Key</label>
                    <p className="setting-description">
                      Your API key is stored only in your browser and sent directly to the AI provider.
                      It is never transmitted to Open Ride servers.
                    </p>
                  </div>
                  <div className="setting-input" style={{ position: 'relative', minWidth: '220px' }}>
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      id="ai-api-key"
                      placeholder={aiSettings.provider === 'openai' ? 'sk-... (OpenAI)' : 'sk-ant-... (Anthropic)'}
                      value={aiSettings.apiKey}
                      onChange={(e) => {
                        const key = e.target.value;
                        const detectedProvider = key.startsWith('sk-ant-') ? 'anthropic' : key.startsWith('sk-') ? 'openai' : null;
                        setAiSettings(prev => ({
                          ...prev,
                          apiKey: key,
                          ...(detectedProvider ? { provider: detectedProvider } : {}),
                        }));
                      }}
                      style={{ paddingRight: '2.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(v => !v)}
                      style={{
                        position: 'absolute',
                        right: '0.5rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'rgba(255,255,255,0.5)',
                        padding: '0.25rem',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                    >
                      {showApiKey ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Security note */}
              <div className="ai-key-security-note">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                  <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                </svg>
                <div>
                  <strong>API key security</strong> — Your key is stored in browser localStorage.
                  Risks to be aware of: browser extensions can read it; anyone with access to
                  DevTools on your machine can see it; it is not end-to-end encrypted.
                  This app loads no external scripts, which eliminates the main XSS vector.
                  On shared or public computers, use private/incognito mode and clear site data
                  when finished (<em>Settings → Privacy → Clear browsing data</em> in Chrome).
                  The key is <strong>never included</strong> in data exports.
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 6h-2.18c.07-.44.18-.88.18-1.36C18 2.06 15.96 0 13.36 0c-1.46 0-2.75.67-3.6 1.7L9 3.5l-.76-1.8C7.39.67 6.11 0 4.64 0 2.06 0 0 2.06 0 4.64c0 .48.1.92.18 1.36H0v2h20V6zm-8.24 0L12 5.08l-.24.92h-1.86c-.09-.29-.14-.6-.14-.92V4.64C9.76 3.19 10.95 2 12.36 2c1.42 0 2.64 1.19 2.64 2.64 0 .32-.05.63-.14.92h-2.1zM4.64 2c1.42 0 2.64 1.19 2.64 2.64 0 .32-.05.63-.14.92H3.14A2.638 2.638 0 0 1 2 4.64C2 3.19 3.19 2 4.64 2zM2 20v-2l1-1v-5H2v-2h16v2h-1v5l1 1v2H2z"/>
                </svg>
                <h2>Data Management</h2>
              </div>

              <div className="settings-card">
                <div className="data-mgmt-row">
                  <div className="setting-info">
                    <label>Export My Data</label>
                    <p className="setting-description">
                      Download all your settings, ride history, training program, and custom workouts
                      as a JSON file. Use it to back up your data or move to another device.
                      <strong> Your API key is not included.</strong>
                    </p>
                  </div>
                  <button
                    className="btn-secondary data-mgmt-btn"
                    onClick={() => downloadExport()}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                    Export
                  </button>
                </div>

                <div className="data-mgmt-row">
                  <div className="setting-info">
                    <label>Import Data</label>
                    <p className="setting-description">
                      Restore from a previously exported backup. Existing data will be overwritten.
                      Your API key will not be restored — re-enter it after import.
                    </p>
                  </div>
                  <label className="btn-secondary data-mgmt-btn data-mgmt-import-label">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
                    </svg>
                    Import
                    <input
                      type="file"
                      accept=".json,application/json"
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        e.target.value = '';
                        try {
                          const result = await importFromFile(file);
                          setImportStatus('success');
                          setImportMessage(
                            `Imported successfully. ${result.warnings.join(' ')} Reload the page to see all changes.`
                          );
                        } catch (err) {
                          setImportStatus('error');
                          setImportMessage(err.message);
                        }
                      }}
                    />
                  </label>
                </div>

                {importStatus && (
                  <div className={`import-result import-result--${importStatus}`}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      {importStatus === 'success'
                        ? <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        : <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>}
                    </svg>
                    {importMessage}
                  </div>
                )}
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11 21h-1l1-7H7.5c-.88 0-.33-.75-.31-.78C8.48 10.94 10.42 7.54 13.01 3h1l-1 7h3.51c.4 0 .62.19.4.66C12.97 17.55 11 21 11 21z"/>
                </svg>
                <h2>Power Zones</h2>
                <span className="zone-info">(Based on your FTP of <span id="ftp-display">{form.ftp}</span>W)</span>
              </div>

              <div className="settings-card zones-card">
                <div className="zones-grid">
                  <div className="zone-row zone-1">
                    <div className="zone-label">Zone 1 - Recovery</div>
                    <div className="zone-range" id="zone1-range">{zoneRanges.zone1}</div>
                    <div className="zone-percent">&lt; 60%</div>
                  </div>
                  <div className="zone-row zone-2">
                    <div className="zone-label">Zone 2 - Endurance</div>
                    <div className="zone-range" id="zone2-range">{zoneRanges.zone2}</div>
                    <div className="zone-percent">60 - 75%</div>
                  </div>
                  <div className="zone-row zone-3">
                    <div className="zone-label">Zone 3 - Tempo</div>
                    <div className="zone-range" id="zone3-range">{zoneRanges.zone3}</div>
                    <div className="zone-percent">76 - 89%</div>
                  </div>
                  <div className="zone-row zone-4">
                    <div className="zone-label">Zone 4 - Threshold</div>
                    <div className="zone-range" id="zone4-range">{zoneRanges.zone4}</div>
                    <div className="zone-percent">90 - 104%</div>
                  </div>
                  <div className="zone-row zone-5">
                    <div className="zone-label">Zone 5 - VO2max</div>
                    <div className="zone-range" id="zone5-range">{zoneRanges.zone5}</div>
                    <div className="zone-percent">105 - 118%</div>
                  </div>
                  <div className="zone-row zone-6">
                    <div className="zone-label">Zone 6 - Anaerobic</div>
                    <div className="zone-range" id="zone6-range">{zoneRanges.zone6}</div>
                    <div className="zone-percent">&gt; 118%</div>
                  </div>
                </div>
              </div>
            </section>

            <div className="settings-actions">
              <button className="btn-secondary" onClick={handleReset}>Reset to Defaults</button>
              <button className="btn-primary" onClick={handleSave}>Save Settings</button>
            </div>

            <div className="settings-legal">
              <Link to="/terms" className="settings-legal-link">Terms of Service</Link>
              <span className="settings-legal-sep">&middot;</span>
              <Link to="/privacy" className="settings-legal-link">Privacy Policy</Link>
            </div>

            <div id="save-toast" className={`save-toast ${showToast ? 'visible' : ''}`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
              Settings saved successfully
            </div>
          </div>
        </div>
      </main>

      <DeviceModal isOpen={isDeviceModalOpen} onClose={() => setIsDeviceModalOpen(false)} />
    </div>
  );
}
