import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import DeviceModal from '../components/DeviceModal';
import { loadCachedWorkouts, loadCustomWorkouts, saveCachedWorkouts } from '../services/dataManager';
import '../styles/training.css';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LABELS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const STORAGE_KEY = 'openride_training_program';

function getTodayKey() {
  const jsDay = new Date().getDay(); // 0=Sun, 1=Mon, ...
  return DAYS[jsDay === 0 ? 6 : jsDay - 1];
}

function getZoneColor(power) {
  if (power <= 0.6) return '#808080';
  if (power <= 0.75) return '#008cff';
  if (power <= 0.89) return '#00d200';
  if (power <= 1.04) return '#ffe600';
  if (power <= 1.18) return '#ff9600';
  return '#ff1e1e';
}

function generateChartBars(chartProfile) {
  if (!chartProfile || chartProfile.length === 0) {
    return Array(20).fill(null).map(() => ({ height: 50, color: '#008cff' }));
  }
  return chartProfile.map((power) => ({
    height: Math.min(100, Math.max(20, (power / 1.5) * 100)),
    color: getZoneColor(power)
  }));
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins} min`;
}

export default function TrainingProgramPage() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
  const [program, setProgram] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (_) {}
    const empty = {};
    DAYS.forEach(d => { empty[d] = []; });
    return empty;
  });

  const [allWorkouts, setAllWorkouts] = useState([]);
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [pickerDay, setPickerDay] = useState(null); // which day the picker is open for
  const [pickerSearch, setPickerSearch] = useState('');
  const [selectedMobileDay, setSelectedMobileDay] = useState(getTodayKey());
  const dayStripRef = useRef(null);

  const todayKey = getTodayKey();
  const todayIndex = DAYS.indexOf(todayKey);

  useEffect(() => {
    fetchWorkouts();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(program));
  }, [program]);

  // Scroll today into view in the day strip on mount
  useEffect(() => {
    if (dayStripRef.current) {
      const todayBtn = dayStripRef.current.querySelector(`[data-day="${todayKey}"]`);
      if (todayBtn) {
        todayBtn.scrollIntoView({ inline: 'center', block: 'nearest' });
      }
    }
  }, []);

  const fetchWorkouts = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/workouts`);
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = await response.json();
      const backendWorkouts = data.workouts || [];
      saveCachedWorkouts(backendWorkouts);
      const customWorkouts = loadCustomWorkouts();
      // Merge: backend first, then custom (dedup by id just in case)
      const backendIds = new Set(backendWorkouts.map(w => w.id));
      const merged = [
        ...backendWorkouts,
        ...customWorkouts.filter(w => !backendIds.has(w.id)),
      ];
      setAllWorkouts(merged);
    } catch (error) {
      const cached = loadCachedWorkouts();
      const customWorkouts = loadCustomWorkouts();
      const backendIds = new Set(cached.map(w => w.id));
      const merged = [
        ...cached,
        ...customWorkouts.filter(w => !backendIds.has(w.id)),
      ];
      setAllWorkouts(merged);
    }
  };

  const filteredPickerWorkouts = useMemo(() => {
    if (!pickerSearch.trim()) return allWorkouts;
    const q = pickerSearch.toLowerCase();
    return allWorkouts.filter(w =>
      w.name.toLowerCase().includes(q) ||
      (w.category && w.category.toLowerCase().includes(q)) ||
      (w.description && w.description.toLowerCase().includes(q))
    );
  }, [allWorkouts, pickerSearch]);

  const addWorkoutToDay = (day, workout) => {
    setProgram(prev => {
      const updated = { ...prev };
      updated[day] = [
        ...updated[day],
        {
          id: workout.id,
          name: workout.name,
          duration: workout.totalDuration,
          category: workout.category || '',
          subcategory: workout.subcategory || '',
          chartProfile: workout.chartProfile || [],
        }
      ];
      return updated;
    });
    setPickerDay(null);
    setPickerSearch('');
  };

  const removeWorkoutFromDay = (day, index) => {
    setProgram(prev => {
      const updated = { ...prev };
      updated[day] = updated[day].filter((_, i) => i !== index);
      return updated;
    });
  };

  const moveWorkout = (fromDay, fromIndex, toDay) => {
    if (fromDay === toDay) return;
    setProgram(prev => {
      const updated = { ...prev };
      const workout = updated[fromDay][fromIndex];
      updated[fromDay] = updated[fromDay].filter((_, i) => i !== fromIndex);
      updated[toDay] = [...updated[toDay], workout];
      return updated;
    });
  };

  const clearDay = (day) => {
    setProgram(prev => ({ ...prev, [day]: [] }));
  };

  const clearAllDays = () => {
    if (!window.confirm('Clear all workouts from the training program?')) return;
    const empty = {};
    DAYS.forEach(d => { empty[d] = []; });
    setProgram(empty);
  };

  const todayWorkouts = program[todayKey] || [];
  const hasAnyWorkouts = DAYS.some(d => program[d] && program[d].length > 0);

  const weeklyStats = useMemo(() => {
    let totalDuration = 0;
    let workoutCount = 0;
    DAYS.forEach(d => {
      (program[d] || []).forEach(w => {
        totalDuration += w.duration || 0;
        workoutCount++;
      });
    });
    return { totalDuration, workoutCount };
  }, [program]);

  // Drag & Drop state
  const [dragInfo, setDragInfo] = useState(null);
  const [dragOverDay, setDragOverDay] = useState(null);

  const handleDragStart = (e, day, index) => {
    setDragInfo({ day, index });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, day) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDay(day);
  };

  const handleDragLeave = () => {
    setDragOverDay(null);
  };

  const handleDrop = (e, toDay) => {
    e.preventDefault();
    setDragOverDay(null);
    if (dragInfo) {
      moveWorkout(dragInfo.day, dragInfo.index, toDay);
      setDragInfo(null);
    }
  };

  const handleDragEnd = () => {
    setDragInfo(null);
    setDragOverDay(null);
  };

  return (
    <div>
      <TopBar onDeviceScanClick={() => setIsDeviceModalOpen(true)} />

      <main id="main-content" className="main-content">
        <div className="content-wrapper">
          {/* Page Header */}
          <section className="tp-header">
            <div className="hero-content">
              <h1>Training Program</h1>
              <p className="hero-subtitle">Plan your weekly training schedule</p>
            </div>
            {hasAnyWorkouts && (
              <div className="tp-header-actions">
                <div className="tp-weekly-stats">
                  <div className="tp-stat">
                    <span className="tp-stat-value">{weeklyStats.workoutCount}</span>
                    <span className="tp-stat-label">Workouts</span>
                  </div>
                  <div className="tp-stat">
                    <span className="tp-stat-value">{formatDuration(weeklyStats.totalDuration)}</span>
                    <span className="tp-stat-label">Total Time</span>
                  </div>
                </div>
                <button className="tp-clear-all-btn" onClick={clearAllDays}>
                  Clear All
                </button>
              </div>
            )}
          </section>

          {/* Today's Workout Hero */}
          {todayWorkouts.length > 0 && (
            <section className="tp-today-hero">
              <div className="tp-today-label">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                </svg>
                Today's Training &mdash; {DAY_LABELS_FULL[todayIndex]}
              </div>
              <div className="tp-today-cards">
                {todayWorkouts.map((workout, i) => {
                  const bars = generateChartBars(workout.chartProfile);
                  return (
                    <div key={`today-${i}`} className="tp-today-card">
                      <div className="tp-today-chart">
                        {bars.map((bar, bi) => (
                          <div
                            key={bi}
                            className="tp-today-chart-bar"
                            style={{ height: `${bar.height}%`, background: bar.color }}
                          />
                        ))}
                      </div>
                      <div className="tp-today-info">
                        <div className="tp-today-meta">
                          {workout.category && (
                            <span className="tp-today-category">{workout.category}</span>
                          )}
                          <span className="tp-today-duration">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                            </svg>
                            {formatDuration(workout.duration)}
                          </span>
                        </div>
                        <h2 className="tp-today-name">{workout.name}</h2>
                        <Link to={`/workout/${workout.id}`} className="tp-start-btn">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                          </svg>
                          Start Workout
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Mobile Day Strip */}
          <div className="tp-day-strip" ref={dayStripRef}>
            {DAYS.map((day, i) => {
              const dayWorkouts = program[day] || [];
              const isToday = day === todayKey;
              const isSelected = day === selectedMobileDay;
              return (
                <button
                  key={day}
                  data-day={day}
                  className={`tp-day-strip-btn ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedMobileDay(day)}
                >
                  <span className="tp-day-strip-label">{DAY_LABELS[i]}</span>
                  {dayWorkouts.length > 0 && (
                    <span className="tp-day-strip-dot" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Mobile Day Detail */}
          <div className="tp-mobile-day-detail">
            <MobileDayView
              day={selectedMobileDay}
              dayLabel={DAY_LABELS_FULL[DAYS.indexOf(selectedMobileDay)]}
              workouts={program[selectedMobileDay] || []}
              isToday={selectedMobileDay === todayKey}
              onAdd={() => { setPickerDay(selectedMobileDay); setPickerSearch(''); }}
              onRemove={(index) => removeWorkoutFromDay(selectedMobileDay, index)}
              onClear={() => clearDay(selectedMobileDay)}
            />
          </div>

          {/* Desktop Weekly Grid */}
          <section className="tp-week-grid">
            {DAYS.map((day, i) => {
              const dayWorkouts = program[day] || [];
              const isToday = day === todayKey;
              return (
                <div
                  key={day}
                  className={`tp-day-column ${isToday ? 'today' : ''} ${dragOverDay === day ? 'drag-over' : ''}`}
                  onDragOver={(e) => handleDragOver(e, day)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, day)}
                >
                  <div className="tp-day-header">
                    <span className={`tp-day-name ${isToday ? 'today' : ''}`}>
                      {DAY_LABELS[i]}
                    </span>
                    {isToday && <span className="tp-today-badge">Today</span>}
                  </div>
                  <div className="tp-day-workouts">
                    {dayWorkouts.map((workout, wi) => {
                      const bars = generateChartBars(workout.chartProfile);
                      return (
                        <div
                          key={`${day}-${wi}`}
                          className="tp-workout-card"
                          draggable
                          onDragStart={(e) => handleDragStart(e, day, wi)}
                          onDragEnd={handleDragEnd}
                        >
                          <div className="tp-workout-chart-mini">
                            {bars.map((bar, bi) => (
                              <div
                                key={bi}
                                className="tp-workout-chart-bar-mini"
                                style={{ height: `${bar.height}%`, background: bar.color }}
                              />
                            ))}
                          </div>
                          <div className="tp-workout-card-body">
                            <div className="tp-workout-card-name">{workout.name}</div>
                            <div className="tp-workout-card-meta">
                              <span>{formatDuration(workout.duration)}</span>
                            </div>
                          </div>
                          <div className="tp-workout-card-actions">
                            <Link
                              to={`/workout/${workout.id}`}
                              className="tp-workout-go-btn"
                              title="Start workout"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                              </svg>
                            </Link>
                            <button
                              className="tp-workout-remove-btn"
                              title="Remove from day"
                              onClick={() => removeWorkoutFromDay(day, wi)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {dayWorkouts.length === 0 && (
                      <div className="tp-day-empty">
                        <span className="tp-day-empty-label">Rest Day</span>
                      </div>
                    )}
                  </div>
                  <button
                    className="tp-add-btn"
                    onClick={() => { setPickerDay(day); setPickerSearch(''); }}
                    title={`Add workout to ${DAY_LABELS_FULL[i]}`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                    </svg>
                  </button>
                </div>
              );
            })}
          </section>

          {/* Empty State */}
          {!hasAnyWorkouts && (
            <section className="tp-empty-state">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.25 }}>
                <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/>
              </svg>
              <h3>No workouts scheduled yet</h3>
              <p>Click the <strong>+</strong> button on any day to add workouts to your weekly plan.</p>
            </section>
          )}
        </div>
      </main>

      {/* Workout Picker Modal */}
      {pickerDay && (
        <div className="tp-picker-overlay" onClick={() => { setPickerDay(null); setPickerSearch(''); }}>
          <div className="tp-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tp-picker-header">
              <h2>Add to {DAY_LABELS_FULL[DAYS.indexOf(pickerDay)]}</h2>
              <button className="tp-picker-close" onClick={() => { setPickerDay(null); setPickerSearch(''); }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <div className="tp-picker-search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <input
                type="text"
                placeholder="Search workouts..."
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="tp-picker-list">
              {filteredPickerWorkouts.map(workout => {
                const bars = generateChartBars(workout.chartProfile);
                return (
                  <button
                    key={workout.id}
                    className="tp-picker-item"
                    onClick={() => addWorkoutToDay(pickerDay, workout)}
                  >
                    <div className="tp-picker-item-chart">
                      {bars.map((bar, bi) => (
                        <div
                          key={bi}
                          className="tp-picker-chart-bar"
                          style={{ height: `${bar.height}%`, background: bar.color }}
                        />
                      ))}
                    </div>
                    <div className="tp-picker-item-info">
                      {workout.category && (
                        <span className="tp-picker-item-category">
                          {workout.category}{workout.subcategory ? ` \u203A ${workout.subcategory}` : ''}
                        </span>
                      )}
                      <span className="tp-picker-item-name">{workout.name}</span>
                      <span className="tp-picker-item-meta">
                        {formatDuration(workout.totalDuration)}
                      </span>
                    </div>
                    <div className="tp-picker-item-add">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                      </svg>
                    </div>
                  </button>
                );
              })}
              {filteredPickerWorkouts.length === 0 && (
                <div className="tp-picker-empty">
                  <p>No workouts found</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <DeviceModal isOpen={isDeviceModalOpen} onClose={() => setIsDeviceModalOpen(false)} />
    </div>
  );
}

/* Mobile Day View sub-component */
function MobileDayView({ day, dayLabel, workouts, isToday, onAdd, onRemove, onClear }) {
  return (
    <div className="tp-mobile-day">
      <div className="tp-mobile-day-header">
        <h3>
          {dayLabel}
          {isToday && <span className="tp-today-badge">Today</span>}
        </h3>
        {workouts.length > 0 && (
          <button className="tp-mobile-clear-btn" onClick={onClear}>Clear</button>
        )}
      </div>
      {workouts.length === 0 ? (
        <div className="tp-mobile-empty">
          <p>Rest Day</p>
          <button className="tp-mobile-add-btn" onClick={onAdd}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            Add Workout
          </button>
        </div>
      ) : (
        <>
          <div className="tp-mobile-workout-list">
            {workouts.map((workout, i) => {
              const bars = generateChartBars(workout.chartProfile);
              return (
                <div key={`m-${i}`} className="tp-mobile-workout-card">
                  <div className="tp-mobile-workout-chart">
                    {bars.map((bar, bi) => (
                      <div
                        key={bi}
                        className="tp-mobile-chart-bar"
                        style={{ height: `${bar.height}%`, background: bar.color }}
                      />
                    ))}
                  </div>
                  <div className="tp-mobile-workout-info">
                    {workout.category && (
                      <span className="tp-mobile-workout-category">{workout.category}</span>
                    )}
                    <span className="tp-mobile-workout-name">{workout.name}</span>
                    <span className="tp-mobile-workout-meta">
                      {formatDuration(workout.duration)}
                    </span>
                  </div>
                  <div className="tp-mobile-workout-actions">
                    <Link to={`/workout/${workout.id}`} className="tp-workout-go-btn" title="Start">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    </Link>
                    <button className="tp-workout-remove-btn" title="Remove" onClick={() => onRemove(i)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="tp-mobile-add-btn" onClick={onAdd}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            Add Another
          </button>
        </>
      )}
    </div>
  );
}
