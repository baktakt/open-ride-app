import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import DeviceModal from '../components/DeviceModal';
import { generateWorkout, saveWorkout, hasAiKey } from '../services/aiWorkoutGenerator';
import '../styles/aiworkout.css';

const GOALS = [
  { value: 'endurance', label: 'Base Endurance', desc: 'Build your aerobic engine with steady, manageable efforts' },
  { value: 'sweet_spot', label: 'Sweet Spot', desc: 'High-efficiency training at 88-93% FTP' },
  { value: 'threshold', label: 'Threshold', desc: 'Push your lactate threshold with sustained hard efforts' },
  { value: 'intervals', label: 'Intervals (HIIT)', desc: 'Short punchy efforts above VO2max for top-end fitness' },
  { value: 'climbing', label: 'Climbing', desc: 'Sustained power for long climbs and rolling terrain' },
  { value: 'recovery', label: 'Recovery', desc: 'Easy spinning to flush the legs after hard days' },
  { value: 'race_prep', label: 'Race Prep', desc: 'Mix of race-pace efforts to sharpen your form' },
];

const INTENSITIES = [
  { value: 'easy', label: 'Easy', desc: 'Zone 1-2, very comfortable' },
  { value: 'moderate', label: 'Moderate', desc: 'Zone 2-3, aerobic effort' },
  { value: 'hard', label: 'Hard', desc: 'Zone 3-4, threshold work' },
  { value: 'very_hard', label: 'Very Hard', desc: 'Zone 4-5, VO2max and above' },
];

const FITNESS_LEVELS = [
  { value: 'beginner', label: 'Beginner', desc: 'New to structured training' },
  { value: 'intermediate', label: 'Intermediate', desc: '1-3 years of regular training' },
  { value: 'advanced', label: 'Advanced', desc: 'Experienced racer or dedicated athlete' },
];

const DURATIONS = [15, 30, 45, 60, 75, 90];

const LOADING_MESSAGES = [
  'Analyzing your fitness profile...',
  'Designing interval structure...',
  'Calculating power targets...',
  'Writing coaching cues...',
  'Balancing load and recovery...',
  'Putting the finishing touches...',
];

function getZoneColor(power) {
  if (power <= 0.6) return '#808080';
  if (power <= 0.75) return '#008cff';
  if (power <= 0.89) return '#00d200';
  if (power <= 1.04) return '#ffe600';
  if (power <= 1.18) return '#ff9600';
  return '#ff1e1e';
}

function parseXmlPreview(xml) {
  const get = (tag) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1].trim() : '';
  };

  const name = get('name') || 'Custom Workout';
  const description = get('description') || '';

  // Build a simple chart profile from the XML segments
  const segments = [];
  const segmentRe = /<(Warmup|Cooldown|SteadyState|Ramp|IntervalsT|FreeRide|MaxEffort)\s([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let match;
  while ((match = segmentRe.exec(xml)) !== null) {
    const type = match[1];
    const attrs = match[2];
    const getAttr = (name) => {
      const m = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'));
      return m ? parseFloat(m[1]) : 0;
    };
    const getIntAttr = (name) => {
      const m = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'));
      return m ? parseInt(m[1], 10) : 0;
    };

    if (type === 'IntervalsT') {
      const repeat = getIntAttr('Repeat') || 1;
      const onDur = getAttr('OnDuration');
      const offDur = getAttr('OffDuration');
      const onPow = getAttr('OnPower');
      const offPow = getAttr('OffPower');
      for (let i = 0; i < repeat; i++) {
        segments.push({ duration: onDur, power: onPow });
        segments.push({ duration: offDur, power: offPow });
      }
    } else {
      const duration = getAttr('Duration');
      const power = getAttr('Power') || ((getAttr('PowerLow') + getAttr('PowerHigh')) / 2) || 0.5;
      segments.push({ duration, power });
    }
  }

  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);

  // Generate 30 chart bars
  const numBars = 30;
  const bars = [];
  if (segments.length > 0) {
    for (let i = 0; i < numBars; i++) {
      const t = (i / numBars) * totalDuration;
      let elapsed = 0;
      let power = 0.5;
      for (const seg of segments) {
        if (t >= elapsed && t < elapsed + seg.duration) {
          power = seg.power;
          break;
        }
        elapsed += seg.duration;
      }
      bars.push({ height: Math.min(100, Math.max(15, (power / 1.5) * 100)), color: getZoneColor(power) });
    }
  }

  const minutes = Math.round(totalDuration / 60);

  return { name, description, bars, totalDuration, minutes };
}

export default function AiWorkoutPage() {
  const navigate = useNavigate();
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);

  // Form state
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [goal, setGoal] = useState('endurance');
  const [intensity, setIntensity] = useState('moderate');
  const [fitnessLevel, setFitnessLevel] = useState('intermediate');
  const [notes, setNotes] = useState('');
  const [customName, setCustomName] = useState('');

  // Generation state
  const [step, setStep] = useState('form'); // 'form' | 'loading' | 'preview' | 'saved'
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0]);
  const [generatedXml, setGeneratedXml] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [savedWorkoutId, setSavedWorkoutId] = useState(null);

  // Editable name in preview
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const editNameRef = useRef(null);

  const apiKeyConfigured = useMemo(() => hasAiKey(), [step]);

  // Focus the name input when entering edit mode
  useEffect(() => {
    if (editingName && editNameRef.current) {
      editNameRef.current.focus();
      editNameRef.current.select();
    }
  }, [editingName]);

  const startEditingName = useCallback(() => {
    setEditNameValue(preview?.name || '');
    setEditingName(true);
  }, [preview]);

  const confirmEditName = useCallback(() => {
    const trimmed = editNameValue.trim();
    if (trimmed && trimmed !== preview?.name) {
      setPreview(prev => ({ ...prev, name: trimmed }));
      // Update the name in the XML so it persists when saved
      if (generatedXml) {
        setGeneratedXml(xml => xml.replace(/<name>[^<]*<\/name>/, `<name>${trimmed}</name>`));
      }
    }
    setEditingName(false);
  }, [editNameValue, preview, generatedXml]);

  const cancelEditName = useCallback(() => {
    setEditingName(false);
  }, []);

  const handleEditNameKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmEditName();
    } else if (e.key === 'Escape') {
      cancelEditName();
    }
  }, [confirmEditName, cancelEditName]);

  const handleGenerate = useCallback(async () => {
    setError(null);
    setStep('loading');
    setLoadingMessage(LOADING_MESSAGES[0]);

    // Cycle through loading messages
    let msgIdx = 0;
    const msgInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOADING_MESSAGES.length;
      setLoadingMessage(LOADING_MESSAGES[msgIdx]);
    }, 1800);

    try {
      let xml = await generateWorkout({ durationMinutes, goal, intensity, fitnessLevel, notes });
      clearInterval(msgInterval);
      // Apply custom name if the user provided one
      if (customName.trim()) {
        xml = xml.replace(/<name>[^<]*<\/name>/, `<name>${customName.trim()}</name>`);
      }
      setGeneratedXml(xml);
      setPreview(parseXmlPreview(xml));
      setStep('preview');
    } catch (err) {
      clearInterval(msgInterval);
      setError(err.message || 'Generation failed');
      setStep('form');
    }
  }, [durationMinutes, goal, intensity, fitnessLevel, notes, customName]);

  const handleRegenerate = useCallback(() => {
    setSavedWorkoutId(null);
    setStep('form');
  }, []);

  const handleSave = useCallback(() => {
    if (!generatedXml) return;
    setError(null);
    try {
      const saved = saveWorkout(generatedXml);
      setSavedWorkoutId(saved.id);
      setStep('saved');
    } catch (err) {
      setError(err.message || 'Failed to save workout');
    }
  }, [generatedXml]);

  const handleStartNow = useCallback(() => {
    if (!generatedXml) return;
    // Save first if not already saved
    if (savedWorkoutId) {
      navigate(`/workout/${savedWorkoutId}`);
      return;
    }
    setError(null);
    try {
      const saved = saveWorkout(generatedXml);
      navigate(`/workout/${saved.id}`);
    } catch (err) {
      setError(err.message || 'Failed to save workout');
    }
  }, [generatedXml, savedWorkoutId, navigate]);

  return (
    <div>
      <TopBar onDeviceScanClick={() => setIsDeviceModalOpen(true)} />

      <main id="main-content" className="main-content">
        <div className="content-wrapper ai-workout-wrapper">

          <section className="ai-header">
            <div className="ai-header-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
              </svg>
            </div>
            <div>
              <h1>AI Workout Generator</h1>
              <p className="ai-header-sub">Personalized workouts tailored to your goals and fitness level</p>
            </div>
          </section>

          {!apiKeyConfigured && step === 'form' && (
            <div className="ai-no-key-banner">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              <span>No API key configured. Add your OpenAI or Anthropic key in <Link to="/settings">Settings</Link> to use this feature.</span>
            </div>
          )}

          {error && (
            <div className="ai-error-banner">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* ---- STEP: FORM ---- */}
          {step === 'form' && (
            <div className="ai-form">
              <section className="ai-section">
                <h2 className="ai-section-title">Duration</h2>
                <div className="ai-duration-grid">
                  {DURATIONS.map(d => (
                    <button
                      key={d}
                      className={`ai-duration-btn ${durationMinutes === d ? 'active' : ''}`}
                      onClick={() => setDurationMinutes(d)}
                    >
                      {d} min
                    </button>
                  ))}
                </div>
              </section>

              <section className="ai-section">
                <h2 className="ai-section-title">Training Goal</h2>
                <div className="ai-option-grid">
                  {GOALS.map(g => (
                    <button
                      key={g.value}
                      className={`ai-option-card ${goal === g.value ? 'active' : ''}`}
                      onClick={() => setGoal(g.value)}
                    >
                      <div className="ai-option-label">{g.label}</div>
                      <div className="ai-option-desc">{g.desc}</div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="ai-section">
                <h2 className="ai-section-title">Intensity</h2>
                <div className="ai-intensity-grid">
                  {INTENSITIES.map(i => (
                    <button
                      key={i.value}
                      className={`ai-intensity-btn ${intensity === i.value ? 'active' : ''}`}
                      onClick={() => setIntensity(i.value)}
                    >
                      <div className="ai-intensity-label">{i.label}</div>
                      <div className="ai-intensity-desc">{i.desc}</div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="ai-section">
                <h2 className="ai-section-title">Fitness Level</h2>
                <div className="ai-fitness-grid">
                  {FITNESS_LEVELS.map(f => (
                    <button
                      key={f.value}
                      className={`ai-fitness-btn ${fitnessLevel === f.value ? 'active' : ''}`}
                      onClick={() => setFitnessLevel(f.value)}
                    >
                      <div className="ai-fitness-label">{f.label}</div>
                      <div className="ai-fitness-desc">{f.desc}</div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="ai-section">
                <h2 className="ai-section-title">Workout Name <span className="ai-optional">(optional)</span></h2>
                <input
                  type="text"
                  className="ai-name-input"
                  placeholder="Leave blank to auto-generate a name"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  maxLength={80}
                />
              </section>

              <section className="ai-section">
                <h2 className="ai-section-title">Additional Notes <span className="ai-optional">(optional)</span></h2>
                <textarea
                  className="ai-notes-input"
                  placeholder="e.g. Focus on high cadence, include some climbing simulation, I have a race in 2 weeks..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={300}
                />
                <div className="ai-notes-count">{notes.length}/300</div>
              </section>

              <div className="ai-generate-row">
                <button
                  className="ai-generate-btn"
                  onClick={handleGenerate}
                  disabled={!apiKeyConfigured}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
                  </svg>
                  Generate Workout
                </button>
                {!apiKeyConfigured && (
                  <p className="ai-key-hint">Add your API key in <Link to="/settings">Settings</Link> first</p>
                )}
              </div>
            </div>
          )}

          {/* ---- STEP: LOADING ---- */}
          {step === 'loading' && (
            <div className="ai-loading">
              <div className="ai-loading-spinner">
                <div className="spinner-ring"></div>
                <div className="spinner-bike">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm5.8-10l2.4-2.4.8.8c1.3 1.3 3 2.1 5 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.5-.4-1-.6-1.6-.6s-1.1.2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6.2l-2.2-2.3zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5z"/>
                  </svg>
                </div>
              </div>
              <p className="ai-loading-msg">{loadingMessage}</p>
              <p className="ai-loading-sub">Your personalized {durationMinutes}-minute workout is being created...</p>
            </div>
          )}

          {/* ---- STEP: PREVIEW ---- */}
          {(step === 'preview' || step === 'saved') && preview && (
            <div className="ai-preview">
              <div className="ai-preview-card">
                <div className="ai-preview-chart">
                  {preview.bars.map((bar, i) => (
                    <div
                      key={i}
                      className="ai-chart-bar"
                      style={{ height: `${bar.height}%`, background: bar.color }}
                    />
                  ))}
                </div>
                <div className="ai-preview-info">
                  <div className="ai-preview-meta">
                    <span className="ai-preview-category">My Workouts · AI Generated</span>
                    {step === 'saved' && (
                      <span className="ai-saved-badge">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        </svg>
                        Saved
                      </span>
                    )}
                  </div>
                  {editingName ? (
                    <div className="ai-preview-name-edit">
                      <input
                        ref={editNameRef}
                        type="text"
                        className="ai-preview-name-input"
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        onKeyDown={handleEditNameKeyDown}
                        onBlur={confirmEditName}
                        maxLength={80}
                      />
                    </div>
                  ) : (
                    <h2
                      className="ai-preview-name ai-preview-name-editable"
                      onClick={startEditingName}
                      title="Click to rename"
                    >
                      {preview.name}
                      <svg className="ai-edit-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                      </svg>
                    </h2>
                  )}
                  <div className="ai-preview-duration">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                    </svg>
                    {preview.minutes} min
                  </div>
                  {preview.description && (
                    <p className="ai-preview-desc">{preview.description}</p>
                  )}
                </div>
              </div>

              {error && (
                <div className="ai-error-banner">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              <div className="ai-preview-actions">
                <button className="ai-btn-secondary" onClick={handleRegenerate}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                  </svg>
                  Generate New
                </button>

                {step !== 'saved' && (
                  <button
                    className="ai-btn-save"
                    onClick={handleSave}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
                    </svg>
                    Save to My Workouts
                  </button>
                )}

                <button
                  className="ai-btn-start"
                  onClick={handleStartNow}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Start Workout
                </button>
              </div>

              {step === 'saved' && savedWorkoutId && (
                <div className="ai-saved-info">
                  <p>Workout saved! Find it in <Link to="/?category=My+Workouts">My Workouts</Link> on the home page.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <DeviceModal isOpen={isDeviceModalOpen} onClose={() => setIsDeviceModalOpen(false)} />
    </div>
  );
}
