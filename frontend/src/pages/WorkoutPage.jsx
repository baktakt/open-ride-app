import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import DeviceModal from '../components/DeviceModal';
import { useAnt } from '../contexts/AntContext';
import { loadCachedWorkout, loadCustomWorkouts, saveCachedWorkout } from '../services/dataManager';
import '../styles/workout.css';
import '../styles/notifications.css';

// Workout Graph Component
function WorkoutGraph({ executionPlan, elapsedSeconds, totalDuration, ftp }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !executionPlan.length) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    const height = canvas.height = canvas.offsetHeight * window.devicePixelRatio;

    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Find max power for scaling
    const maxPower = Math.max(...executionPlan.map(s => s.targetPower), 300);

    // Draw each segment
    let currentX = 0;
    executionPlan.forEach((segment, index) => {
      const segmentWidth = (segment.duration / totalDuration) * (width / window.devicePixelRatio);
      const segmentHeight = (segment.targetPower / maxPower) * (height / window.devicePixelRatio) * 0.8;

      // Color based on power intensity
      let color;
      const intensity = (segment.targetPower / (ftp || 200)) * 100;
      if (intensity < 60) color = 'rgba(76, 175, 80, 0.7)'; // Green
      else if (intensity < 75) color = 'rgba(255, 193, 7, 0.7)'; // Yellow
      else if (intensity < 90) color = 'rgba(255, 152, 0, 0.7)'; // Orange
      else color = 'rgba(244, 67, 54, 0.7)'; // Red

      ctx.fillStyle = color;
      ctx.fillRect(
        currentX,
        (height / window.devicePixelRatio) - segmentHeight,
        segmentWidth,
        segmentHeight
      );

      // Draw border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        currentX,
        (height / window.devicePixelRatio) - segmentHeight,
        segmentWidth,
        segmentHeight
      );

      currentX += segmentWidth;
    });
  }, [executionPlan, totalDuration]);

  return <canvas ref={canvasRef} id="workout-graph" style={{ width: '100%', height: '100%' }} />;
}

export default function WorkoutPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { connectedDevice, telemetry, setTargetPower } = useAnt();
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';

  const [workout, setWorkout] = useState(null);
  const [executionPlan, setExecutionPlan] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [segmentElapsed, setSegmentElapsed] = useState(0);
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [ftp, setFtp] = useState(200);
  const [intensityBias, setIntensityBias] = useState(100);
  const [countdownValue, setCountdownValue] = useState(null);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [completeStats, setCompleteStats] = useState(null);
  const [hasEnded, setHasEnded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState(() => {
    try {
      const stored = localStorage.getItem('openride_settings');
      if (stored) return JSON.parse(stored);
    } catch (_) {}
    return { ftp: 200, maxHr: 185, restingHr: 60, weight: 70 };
  });

  const timerRef = useRef(null);
  const countdownRef = useRef(null);
  const telemetryRef = useRef(telemetry);
  const intensityBiasRef = useRef(100);
  const workoutElementsRef = useRef(null);
  const workoutStatsRef = useRef({
    totalPower: 0,
    powerReadings: 0,
    maxPower: 0,
    totalCadence: 0,
    cadenceReadings: 0
  });

  useEffect(() => {
    document.body.classList.add('workout-page');
    return () => {
      document.body.classList.remove('workout-page');
    };
  }, []);

  useEffect(() => {
    // Load FTP from settings
    let ftpValue = 200;
    const settings = localStorage.getItem('openride_settings');
    if (settings) {
      const parsed = JSON.parse(settings);
      ftpValue = parsed.ftp || 200;
    }
    setFtp(ftpValue);

    fetchWorkout(ftpValue);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [id]);

  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);

  useEffect(() => {
    intensityBiasRef.current = intensityBias;
  }, [intensityBias]);

  const applyBias = (power) => Math.round(power * intensityBias / 100);

  const adjustIntensity = (delta) => {
    setIntensityBias(prev => {
      const next = Math.max(90, Math.min(110, prev + delta));
      return next;
    });
  };

  const applySettings = () => {
    const newFtp = parseInt(settingsForm.ftp, 10) || 200;
    const toSave = {
      ...settingsForm,
      ftp: newFtp,
      maxHr: parseInt(settingsForm.maxHr, 10) || 185,
      restingHr: parseInt(settingsForm.restingHr, 10) || 60,
      weight: parseFloat(settingsForm.weight) || 70
    };
    localStorage.setItem('openride_settings', JSON.stringify(toSave));
    setSettingsForm(toSave);
    setFtp(newFtp);

    // Rebuild execution plan with new FTP
    if (workoutElementsRef.current) {
      const newPlan = buildExecutionPlan(workoutElementsRef.current, newFtp);
      setExecutionPlan(newPlan);

      // Update trainer target for the current segment
      if (isRunning && !isPaused && connectedDevice && newPlan[currentSegmentIndex]) {
        setTargetPower(Math.round(newPlan[currentSegmentIndex].targetPower * intensityBias / 100));
      }
    }
    setShowSettings(false);
  };

  const saveWorkoutHistory = (stats) => {
    try {
      const history = JSON.parse(localStorage.getItem('openride_workout_history') || '[]');
      history.unshift({
        id: Date.now(),
        date: new Date().toISOString(),
        workoutId: id,
        workoutName: workout?.name || 'Workout',
        ...stats
      });
      // Keep last 50 entries
      if (history.length > 50) history.length = 50;
      localStorage.setItem('openride_workout_history', JSON.stringify(history));
    } catch (e) {
      console.error('Failed to save workout history:', e);
    }
  };

  useEffect(() => {
    if (!showEndConfirm) return;
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setShowEndConfirm(false);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showEndConfirm]);

  const applyWorkoutData = (data, ftpValue) => {
    if (!data || !Array.isArray(data.elements)) {
      setLoadError('Workout data is unavailable.');
      return;
    }
    setWorkout(data);
    workoutElementsRef.current = data.elements;

    // Build execution plan using the FTP value passed directly
    const plan = buildExecutionPlan(data.elements, ftpValue);
    setExecutionPlan(plan);
  };

  const fetchWorkout = async (ftpValue) => {
    setLoadError(null);
    setWorkout(null);
    setExecutionPlan([]);
    try {
      const custom = loadCustomWorkouts().find(w => w.id === id);
      if (custom) {
        applyWorkoutData(custom, ftpValue);
        return;
      }

      const response = await fetch(`${apiBaseUrl}/api/workouts/${id}`);
      if (response.status === 404) {
        setLoadError('Workout not found.');
        return;
      }
      if (!response.ok) throw new Error(`API error ${response.status}`);

      const data = await response.json();
      saveCachedWorkout(data);
      applyWorkoutData(data, ftpValue);
    } catch (error) {
      const cached = loadCachedWorkout(id);
      if (cached) {
        applyWorkoutData(cached, ftpValue);
        return;
      }
      setLoadError('Workout library is offline. You can still use My Workouts or try again later.');
    }
  };

  const buildExecutionPlan = (elements, ftpValue) => {
    if (!elements) return [];
    const effectiveFtp = ftpValue || ftp;

    const plan = [];
    elements.forEach(element => {
      if (element.type === 'SteadyState') {
        plan.push({
          name: 'Steady',
          duration: element.duration,
          targetPower: Math.round(element.power * effectiveFtp),
          targetCadence: element.cadence || 90,
          text: element.textEvents?.[0]?.message
        });
      } else if (element.type === 'Warmup') {
        plan.push({
          name: 'Warmup',
          duration: element.duration,
          targetPower: Math.round(((element.powerLow + element.powerHigh) / 2) * effectiveFtp),
          targetCadence: element.cadence || 90,
          text: element.textEvents?.[0]?.message
        });
      } else if (element.type === 'Cooldown') {
        plan.push({
          name: 'Cooldown',
          duration: element.duration,
          targetPower: Math.round(((element.powerLow + element.powerHigh) / 2) * effectiveFtp),
          targetCadence: element.cadence || 90,
          text: element.textEvents?.[0]?.message
        });
      } else if (element.type === 'Ramp') {
        plan.push({
          name: 'Ramp',
          duration: element.duration,
          targetPower: Math.round(((element.powerLow + element.powerHigh) / 2) * effectiveFtp),
          targetCadence: element.cadence || 90,
          text: element.textEvents?.[0]?.message
        });
      } else if (element.type === 'IntervalsT') {
        for (let i = 0; i < element.repeat; i++) {
          plan.push({
            name: `Interval ${i + 1} (ON)`,
            duration: element.onDuration,
            targetPower: Math.round(element.onPower * effectiveFtp),
            targetCadence: element.cadence || 90,
            text: `Interval ${i + 1} - Push!`
          });
          plan.push({
            name: `Recovery ${i + 1}`,
            duration: element.offDuration,
            targetPower: Math.round(element.offPower * effectiveFtp),
            targetCadence: element.cadenceResting || 85,
            text: `Interval ${i + 1} - Recover`
          });
        }
      } else if (element.type === 'FreeRide') {
        plan.push({
          name: 'Free Ride',
          duration: element.duration,
          targetPower: 0,
          targetCadence: 90,
          text: 'Ride at your own pace'
        });
      }
    });

    return plan;
  };

  const getCountdownDuration = () => {
    try {
      const settings = localStorage.getItem('openride_settings');
      if (settings) {
        const parsed = JSON.parse(settings);
        return parsed.countdownDuration || 3;
      }
    } catch (_) {
      return 3;
    }
    return 3;
  };

  const startCountdown = () => {
    if (countdownRef.current || isRunning) return;
    let count = getCountdownDuration();
    setCountdownValue(count);
    countdownRef.current = setInterval(() => {
      count -= 1;
      if (count > 0) {
        setCountdownValue(count);
      } else {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdownValue(null);
        startWorkout();
      }
    }, 1000);
  };

  useEffect(() => {
    if (!workout || !executionPlan.length) return;
    if (isRunning || countdownValue !== null || hasEnded) return;
    // Wait for user to start from the preview screen.
  }, [workout, executionPlan.length, isRunning, countdownValue, hasEnded]);

  const startWorkout = () => {
    setIsRunning(true);
    setIsPaused(false);
    setElapsedSeconds(0);
    setSegmentElapsed(0);
    setCurrentSegmentIndex(0);
    setHasEnded(false);
    workoutStatsRef.current = {
      totalPower: 0,
      powerReadings: 0,
      maxPower: 0,
      totalCadence: 0,
      cadenceReadings: 0
    };

    // Set initial target power with intensity bias applied
    if (executionPlan[0] && connectedDevice) {
      setTargetPower(applyBias(executionPlan[0].targetPower));
    }

    timerRef.current = setInterval(() => {
      const currentTelemetry = telemetryRef.current;
      if (currentTelemetry.power > 0) {
        workoutStatsRef.current.totalPower += currentTelemetry.power;
        workoutStatsRef.current.powerReadings += 1;
        workoutStatsRef.current.maxPower = Math.max(workoutStatsRef.current.maxPower, currentTelemetry.power);
      }

      if (currentTelemetry.cadence > 0) {
        workoutStatsRef.current.totalCadence += currentTelemetry.cadence;
        workoutStatsRef.current.cadenceReadings += 1;
      }

      setElapsedSeconds(prev => prev + 1);
      setSegmentElapsed(prev => prev + 1);
    }, 1000);
  };

  const togglePause = () => {
    if (isPaused) {
      // Resume
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        const currentTelemetry = telemetryRef.current;
        if (currentTelemetry.power > 0) {
          workoutStatsRef.current.totalPower += currentTelemetry.power;
          workoutStatsRef.current.powerReadings += 1;
          workoutStatsRef.current.maxPower = Math.max(workoutStatsRef.current.maxPower, currentTelemetry.power);
        }

        if (currentTelemetry.cadence > 0) {
          workoutStatsRef.current.totalCadence += currentTelemetry.cadence;
          workoutStatsRef.current.cadenceReadings += 1;
        }

        setElapsedSeconds(prev => prev + 1);
        setSegmentElapsed(prev => prev + 1);
      }, 1000);
    } else {
      // Pause
      setIsPaused(true);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const skipSegment = () => {
    if (currentSegmentIndex < executionPlan.length - 1) {
      const nextIndex = currentSegmentIndex + 1;
      const elapsedToNext = executionPlan
        .slice(0, nextIndex)
        .reduce((sum, segment) => sum + segment.duration, 0);
      setCurrentSegmentIndex(nextIndex);
      setSegmentElapsed(0);
      setElapsedSeconds(elapsedToNext);

      if (executionPlan[nextIndex] && connectedDevice) {
        setTargetPower(applyBias(executionPlan[nextIndex].targetPower));
      }
    }
  };

  const endWorkout = () => {
    setShowEndConfirm(true);
  };

  const completeWorkout = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    const duration = elapsedSeconds;
    const avgPower = workoutStatsRef.current.powerReadings > 0
      ? Math.round(workoutStatsRef.current.totalPower / workoutStatsRef.current.powerReadings)
      : 0;
    const avgCadence = workoutStatsRef.current.cadenceReadings > 0
      ? Math.round(workoutStatsRef.current.totalCadence / workoutStatsRef.current.cadenceReadings)
      : 0;
    const distance = telemetryRef.current.distance || 0;
    const totalKJ = (avgPower * duration) / 1000;
    const calories = Math.round(totalKJ / 4.184);
    const intensityFactor = ftp > 0 ? (avgPower / ftp).toFixed(2) : '--';

    const stats = {
      duration,
      distance,
      avgPower,
      maxPower: Math.round(workoutStatsRef.current.maxPower),
      avgCadence,
      calories,
      intensityFactor,
      ftp
    };

    setIsRunning(false);
    setHasEnded(true);
    setTargetPower(0);
    setCompleteStats(stats);
    saveWorkoutHistory(stats);
    setShowComplete(true);
  };

  // Apply intensity bias changes immediately to the trainer
  useEffect(() => {
    if (!isRunning || isPaused || !executionPlan.length || !connectedDevice) return;
    const currentPower = executionPlan[currentSegmentIndex]?.targetPower;
    if (currentPower) {
      setTargetPower(applyBias(currentPower));
    }
  }, [intensityBias]);

  // Handle segment transitions
  useEffect(() => {
    if (!isRunning || isPaused || !executionPlan.length) return;

    const currentSegment = executionPlan[currentSegmentIndex];
    if (!currentSegment) return;

    if (segmentElapsed >= currentSegment.duration) {
      const nextIndex = currentSegmentIndex + 1;
      if (nextIndex < executionPlan.length) {
        setCurrentSegmentIndex(nextIndex);
        setSegmentElapsed(0);

        if (executionPlan[nextIndex] && connectedDevice) {
          setTargetPower(applyBias(executionPlan[nextIndex].targetPower));
        }
      } else {
        // Workout complete
        completeWorkout();
      }
    }
  }, [segmentElapsed, isRunning, isPaused, executionPlan, currentSegmentIndex]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loadError) {
    return (
      <div>
        <TopBar onDeviceScanClick={() => setIsDeviceModalOpen(true)} />
        <div className="workout-error">
          <h2>Workout unavailable</h2>
          <p>{loadError}</p>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            Back to Home
          </button>
        </div>
        <DeviceModal isOpen={isDeviceModalOpen} onClose={() => setIsDeviceModalOpen(false)} />
      </div>
    );
  }

  if (!workout || !executionPlan.length) {
    return (
      <div>
        <TopBar onDeviceScanClick={() => setIsDeviceModalOpen(true)} />
        <div className="loading">Loading workout...</div>
        <DeviceModal isOpen={isDeviceModalOpen} onClose={() => setIsDeviceModalOpen(false)} />
      </div>
    );
  }

  const currentSegment = executionPlan[currentSegmentIndex] || {};
  const totalDuration = executionPlan.reduce((sum, seg) => sum + seg.duration, 0);
  const remainingTime = totalDuration - elapsedSeconds;
  const upcomingSegments = executionPlan.slice(currentSegmentIndex, currentSegmentIndex + 6);
  const showPreview = !isRunning && !showComplete && countdownValue === null;
  const targetPower = Math.max(0, applyBias(currentSegment.targetPower || 0));
  const currentPower = Math.round(telemetry.power || 0);
  const targetCadence = Math.max(0, Math.round(currentSegment.targetCadence || 0));
  const currentCadence = Math.round(telemetry.cadence || 0);

  const buildGaugeState = ({ current, target, tolerancePct, minTolerance, underText, overText }) => {
    if (!target) {
      return {
        status: 'free',
        statusText: 'FREE RIDE',
        gaugePosition: 50,
        okWidth: 0,
      };
    }
    const tolerance = Math.max(minTolerance, Math.round(target * tolerancePct));
    const delta = current - target;
    const isOn = Math.abs(delta) <= tolerance;
    const status = isOn ? 'on' : (delta > 0 ? 'over' : 'under');
    const statusText = isOn ? 'ON TARGET' : (delta > 0 ? overText : underText);
    const ratio = current / target;
    const clampedRatio = Math.max(0, Math.min(2, ratio));
    const gaugePosition = (clampedRatio / 2) * 100;
    const okWidth = Math.min(32, Math.max(12, (tolerance / target) * 280));
    return { status, statusText, gaugePosition, okWidth };
  };

  const powerGauge = buildGaugeState({
    current: currentPower,
    target: targetPower,
    tolerancePct: 0.03,
    minTolerance: 2,
    underText: 'MORE POWER',
    overText: 'LESS POWER',
  });

  const cadenceGauge = buildGaugeState({
    current: currentCadence,
    target: targetCadence,
    tolerancePct: 0.04,
    minTolerance: 3,
    underText: 'SPIN FASTER',
    overText: 'SPIN SLOWER',
  });

  const powerCardClass = `metric-card gauge-card status-${powerGauge.status}`;
  const cadenceCardClass = `metric-card gauge-card status-${cadenceGauge.status}`;

  const getZoneClass = (targetPower) => {
    if (!targetPower || !ftp) return 2;
    const intensity = targetPower / ftp;
    if (intensity < 0.6) return 1;
    if (intensity < 0.75) return 2;
    if (intensity < 0.89) return 3;
    if (intensity < 1.04) return 4;
    if (intensity < 1.18) return 5;
    return 6;
  };

  return (
    <div>
      <TopBar onDeviceScanClick={() => setIsDeviceModalOpen(true)} />

      {showPreview ? (
        <main id="main-content" className="workout-preview">
          <div className="preview-content">
            <h1>{workout.name}</h1>
            <p className="workout-description">{workout.description}</p>

            <div className="workout-stats">
              <div className="stat-item">
                <span className="stat-label">Duration</span>
                <span className="stat-value">{formatTime(totalDuration)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Segments</span>
                <span className="stat-value">{executionPlan.length}</span>
              </div>
            </div>

            <button
              className="btn btn-primary btn-large"
              onClick={startCountdown}
              disabled={!connectedDevice}
            >
              Start Ride
            </button>
            {!connectedDevice && (
              <p className="hint-text">Connect a trainer to start</p>
            )}
          </div>
        </main>
      ) : (
      <main id="main-content" className="workout-main">
        <div className="workout-graph-container">
          <WorkoutGraph executionPlan={executionPlan} elapsedSeconds={elapsedSeconds} totalDuration={totalDuration} ftp={ftp} />
          <div
            className="workout-progress-line"
            style={{ left: `${(elapsedSeconds / totalDuration) * 100}%` }}
          ></div>
        </div>

        <div className="segment-info">
          <div className="segment-current">{currentSegment.name}</div>
          <div className="effort-adjust">
            <button
              className="effort-btn"
              onClick={() => adjustIntensity(-1)}
              disabled={intensityBias <= 90}
              title="Decrease intensity"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12,16 4,8 20,8"/>
              </svg>
            </button>
            <div className="effort-display">
              <span className="effort-label">Effort</span>
              <span className={`effort-value ${intensityBias !== 100 ? 'adjusted' : ''}`}>
                {intensityBias}%
              </span>
            </div>
            <button
              className="effort-btn"
              onClick={() => adjustIntensity(1)}
              disabled={intensityBias >= 110}
              title="Increase intensity"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12,8 4,16 20,16"/>
              </svg>
            </button>
          </div>
          <div className="segment-timing">
            <span>{formatTime(segmentElapsed)}</span>
            <span className="segment-separator">/</span>
            <span>{formatTime(currentSegment.duration)}</span>
          </div>
        </div>

        <div className="workout-metrics">
          <div className="metrics-top">
            <div className={powerCardClass} style={{ '--gauge-position': `${powerGauge.gaugePosition}%`, '--ok-width': `${powerGauge.okWidth}%` }}>
              <div className="gauge-header">
                <div className="metric-label">POWER</div>
                <div className="gauge-status">{powerGauge.statusText}</div>
              </div>
              <div className="gauge-body">
                <div className="gauge-value">
                  {currentPower}
                  <span>W</span>
                </div>
              </div>
              <div className="gauge-line" aria-hidden="true">
                <div className="gauge-track"></div>
                <div className="gauge-ok"></div>
                <div className="gauge-needle"></div>
              </div>
              <div className="gauge-footer">
                <span className="gauge-target">
                  Target <strong>{targetPower || '--'}</strong>W
                  {intensityBias !== 100 && (
                    <span className="metric-bias"> ({intensityBias}%)</span>
                  )}
                </span>
              </div>
            </div>

            <div className={cadenceCardClass} style={{ '--gauge-position': `${cadenceGauge.gaugePosition}%`, '--ok-width': `${cadenceGauge.okWidth}%` }}>
              <div className="gauge-header">
                <div className="metric-label">CADENCE</div>
                <div className="gauge-status">{cadenceGauge.statusText}</div>
              </div>
              <div className="gauge-body">
                <div className="gauge-value">
                  {currentCadence}
                  <span>rpm</span>
                </div>
              </div>
              <div className="gauge-line" aria-hidden="true">
                <div className="gauge-track"></div>
                <div className="gauge-ok"></div>
                <div className="gauge-needle"></div>
              </div>
              <div className="gauge-footer">
                <span className="gauge-target">
                  Target <strong>{targetCadence || '--'}</strong> rpm
                </span>
              </div>
            </div>
          </div>

          <div className="metrics-bottom">
          <div className="metric-card time">
            <div className="metric-label">TIME</div>
            <div className="metric-value">{formatTime(elapsedSeconds)}</div>
            <div className="metric-secondary">
              <span>Remaining:</span> {formatTime(remainingTime)}
            </div>
          </div>

          <div className="metric-card heart-rate">
            <div className="metric-label">HEART RATE</div>
            <div className="metric-value">
              <span>{telemetry.heartRate || '--'}</span>
              <span className="metric-unit">bpm</span>
            </div>
          </div>

          <div className="metric-card speed">
            <div className="metric-label">SPEED</div>
            <div className="metric-value">
              <span>{telemetry.speed.toFixed(1)}</span>
              <span className="metric-unit">km/h</span>
            </div>
          </div>

          <div className="metric-card distance">
            <div className="metric-label">DISTANCE</div>
            <div className="metric-value">
              <span>{(telemetry.distance / 1000).toFixed(2)}</span>
              <span className="metric-unit">km</span>
            </div>
          </div>
          </div>
        </div>

        <div className="workout-controls">
          <button className="control-btn secondary" onClick={togglePause} disabled={!isRunning}>
            {isPaused ? (
              <>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
                Resume
              </>
            ) : (
              <>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16"/>
                  <rect x="14" y="4" width="4" height="16"/>
                </svg>
                Pause
              </>
            )}
          </button>

          <button className="control-btn secondary" onClick={skipSegment} disabled={!isRunning}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,4 15,12 5,20"/>
              <rect x="18" y="4" width="3" height="16"/>
            </svg>
            Skip
          </button>

          <button className="control-btn secondary" onClick={() => setShowSettings(true)} title="Settings">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.6 3.6 0 0112 15.6z"/>
            </svg>
            Settings
          </button>

          <button className="control-btn danger" onClick={endWorkout}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12"/>
            </svg>
            End
          </button>
        </div>
      </main>
      )}

      <aside className="upcoming-segments">
        <h3>Up Next</h3>
        <div className="upcoming-list">
          {upcomingSegments.map((segment, idx) => {
            const zone = getZoneClass(segment.targetPower);
            const isActive = idx === 0;
            return (
              <div key={`${segment.name}-${idx}`} className={`upcoming-item ${isActive ? 'active' : ''} zone-${zone}`}>
                <div className="upcoming-name">{segment.name}</div>
                <div className="upcoming-details">
                  <span>{formatTime(segment.duration)}</span>
                  <span>{segment.targetPower ? `${Math.round((segment.targetPower / ftp) * 100)}% FTP` : 'Free'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {countdownValue !== null && (
        <div className="countdown-overlay">
          <div className="countdown-number">{countdownValue}</div>
          <div className="countdown-text">Get ready...</div>
        </div>
      )}

      {showSettings && (
        <div className="workout-settings-overlay">
          <div className="workout-settings-backdrop" onClick={() => setShowSettings(false)}></div>
          <div className="workout-settings-panel">
            <div className="settings-panel-header">
              <h3>Settings</h3>
              <button className="settings-panel-close" onClick={() => setShowSettings(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <div className="settings-panel-body">
              <div className="settings-panel-row">
                <label htmlFor="ws-ftp">FTP</label>
                <div className="settings-panel-input">
                  <input
                    type="number"
                    id="ws-ftp"
                    min="50"
                    max="500"
                    value={settingsForm.ftp}
                    onChange={e => setSettingsForm(prev => ({ ...prev, ftp: e.target.value }))}
                  />
                  <span>W</span>
                </div>
              </div>
              <div className="settings-panel-row">
                <label htmlFor="ws-maxhr">Max HR</label>
                <div className="settings-panel-input">
                  <input
                    type="number"
                    id="ws-maxhr"
                    min="100"
                    max="220"
                    value={settingsForm.maxHr}
                    onChange={e => setSettingsForm(prev => ({ ...prev, maxHr: e.target.value }))}
                  />
                  <span>bpm</span>
                </div>
              </div>
              <div className="settings-panel-row">
                <label htmlFor="ws-rhr">Resting HR</label>
                <div className="settings-panel-input">
                  <input
                    type="number"
                    id="ws-rhr"
                    min="30"
                    max="100"
                    value={settingsForm.restingHr}
                    onChange={e => setSettingsForm(prev => ({ ...prev, restingHr: e.target.value }))}
                  />
                  <span>bpm</span>
                </div>
              </div>
              <div className="settings-panel-row">
                <label htmlFor="ws-weight">Weight</label>
                <div className="settings-panel-input">
                  <input
                    type="number"
                    id="ws-weight"
                    min="30"
                    max="200"
                    step="0.1"
                    value={settingsForm.weight}
                    onChange={e => setSettingsForm(prev => ({ ...prev, weight: e.target.value }))}
                  />
                  <span>kg</span>
                </div>
              </div>
              <p className="settings-panel-hint">
                Changing FTP will recalculate all target power values for the remaining workout.
              </p>
            </div>
            <div className="settings-panel-actions">
              <button className="control-btn secondary" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="control-btn primary" onClick={applySettings}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {showEndConfirm && (
        <div className="notification-modal show">
          <div className="notification-modal-backdrop" onClick={() => setShowEndConfirm(false)}></div>
          <div className="notification-modal-content">
            <div className="notification-modal-icon">⚠️</div>
            <div className="notification-modal-message">Are you sure you want to end the workout?</div>
            <div className="notification-modal-actions">
              <button className="notification-btn notification-btn-secondary" onClick={() => setShowEndConfirm(false)}>
                Cancel
              </button>
              <button
                className="notification-btn notification-btn-primary"
                onClick={() => {
                  setShowEndConfirm(false);
                  completeWorkout();
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {showComplete && completeStats && (
        <div className="complete-overlay">
          <div className="complete-content">
            <div className="complete-header">
              <div className="complete-icon">✓</div>
              <div className="complete-title">Workout Complete</div>
              <div className="complete-workout-name">{workout?.name || 'Workout'}</div>
            </div>

            <div className="complete-stats">
              <div className="complete-stat">
                <div className="complete-stat-value">{formatTime(completeStats.duration)}</div>
                <div className="complete-stat-label">Duration</div>
              </div>
              <div className="complete-stat">
                <div className="complete-stat-value">
                  {(completeStats.distance / 1000).toFixed(1)}
                  <span className="stat-unit">km</span>
                </div>
                <div className="complete-stat-label">Distance</div>
              </div>
              <div className="complete-stat highlight">
                <div className="complete-stat-value">
                  {completeStats.avgPower}
                  <span className="stat-unit">W</span>
                </div>
                <div className="complete-stat-label">Avg Power</div>
              </div>
              <div className="complete-stat">
                <div className="complete-stat-value">
                  {completeStats.maxPower}
                  <span className="stat-unit">W</span>
                </div>
                <div className="complete-stat-label">Max Power</div>
              </div>
              <div className="complete-stat">
                <div className="complete-stat-value">
                  {completeStats.avgCadence}
                  <span className="stat-unit">rpm</span>
                </div>
                <div className="complete-stat-label">Avg Cadence</div>
              </div>
              <div className="complete-stat">
                <div className="complete-stat-value">
                  {completeStats.calories}
                  <span className="stat-unit">kcal</span>
                </div>
                <div className="complete-stat-label">Calories</div>
              </div>
            </div>

            <div className="complete-secondary">
              <div className="complete-secondary-stat">
                <span className="secondary-label">Intensity Factor:</span>
                <span className="secondary-value">{completeStats.intensityFactor}</span>
              </div>
              <div className="complete-secondary-stat">
                <span className="secondary-label">FTP:</span>
                <span className="secondary-value">{completeStats.ftp}W</span>
              </div>
            </div>

            <div className="complete-actions">
              <button className="complete-btn secondary" onClick={() => navigate('/')}>Back to Home</button>
              <button className="complete-btn primary" onClick={() => window.location.reload()}>Ride Again</button>
            </div>
          </div>
        </div>
      )}

      <DeviceModal isOpen={isDeviceModalOpen} onClose={() => setIsDeviceModalOpen(false)} />
    </div>
  );
}
