import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import DeviceModal from '../components/DeviceModal';
import { deleteCustomWorkout, renameCustomWorkout } from '../services/aiWorkoutGenerator';
import {
  loadCachedWorkouts,
  loadCachedWorkoutsTimestamp,
  loadCustomWorkouts,
  saveCachedWorkouts
} from '../services/dataManager';
import '../styles/index.css';

export default function HomePage() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'mine'
  const [workouts, setWorkouts] = useState([]);
  const [filteredWorkouts, setFilteredWorkouts] = useState([]);
  const [selectedDuration, setSelectedDuration] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [rideHistory, setRideHistory] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const [myWorkouts, setMyWorkouts] = useState(() => loadCustomWorkouts());
  const [apiStatus, setApiStatus] = useState('loading'); // 'loading' | 'ok' | 'cached' | 'offline'
  const [cachedAt, setCachedAt] = useState(null);
  const categoryScrollRef = useRef(null);

  useEffect(() => {
    fetchWorkouts();
    loadHistory();
  }, []);

  const loadHistory = () => {
    try {
      const stored = localStorage.getItem('openride_workout_history');
      if (stored) setRideHistory(JSON.parse(stored));
    } catch (_) {}
  };

  const clearHistory = () => {
    if (!window.confirm('Clear all ride history?')) return;
    localStorage.removeItem('openride_workout_history');
    setRideHistory([]);
  };

  const formatHistoryDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatHistoryTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const fetchWorkouts = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/workouts`);
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = await response.json();
      const workoutsList = data.workouts || [];
      setWorkouts(workoutsList);
      setFilteredWorkouts(workoutsList);
      saveCachedWorkouts(workoutsList);
      setCachedAt(loadCachedWorkoutsTimestamp());
      setApiStatus('ok');
    } catch (error) {
      const cached = loadCachedWorkouts();
      if (cached.length > 0) {
        setWorkouts(cached);
        setFilteredWorkouts(cached);
        setApiStatus('cached');
      } else {
        const local = loadCustomWorkouts();
        if (local.length > 0) {
          setWorkouts(local);
          setFilteredWorkouts(local);
        } else {
          setWorkouts([]);
          setFilteredWorkouts([]);
        }
        setApiStatus('offline');
      }
      setCachedAt(loadCachedWorkoutsTimestamp());
    }
  };

  // Derive categories with counts and subcategories
  const categoryData = useMemo(() => {
    const cats = {};
    workouts.forEach(w => {
      if (!w.category) return;
      if (!cats[w.category]) {
        cats[w.category] = { count: 0, subcategories: {} };
      }
      cats[w.category].count++;
      if (w.subcategory) {
        cats[w.category].subcategories[w.subcategory] =
          (cats[w.category].subcategories[w.subcategory] || 0) + 1;
      }
    });
    return cats;
  }, [workouts]);

  const categories = useMemo(() => Object.keys(categoryData).sort(), [categoryData]);

  const subcategories = useMemo(() => {
    if (!selectedCategory || !categoryData[selectedCategory]) return [];
    const subs = categoryData[selectedCategory].subcategories;
    return Object.entries(subs).sort(([a], [b]) => a.localeCompare(b));
  }, [selectedCategory, categoryData]);

  // Filter workouts
  useEffect(() => {
    let filtered = [...workouts];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(w =>
        w.name.toLowerCase().includes(q) ||
        (w.description && w.description.toLowerCase().includes(q)) ||
        (w.category && w.category.toLowerCase().includes(q)) ||
        (w.tags && w.tags.some(t => t.toLowerCase().includes(q)))
      );
    }

    // Category filter
    if (selectedCategory) {
      filtered = filtered.filter(w => w.category === selectedCategory);
    }

    // Subcategory filter
    if (selectedSubcategory) {
      filtered = filtered.filter(w => w.subcategory === selectedSubcategory);
    }

    // Duration filter
    if (selectedDuration) {
      filtered = filtered.filter(w => {
        const duration = w.totalDuration || 0;
        if (selectedDuration === 'short') return duration <= 30 * 60;
        if (selectedDuration === 'medium') return duration > 30 * 60 && duration <= 60 * 60;
        if (selectedDuration === 'long') return duration > 60 * 60;
        return true;
      });
    }

    setFilteredWorkouts(filtered);
  }, [selectedDuration, selectedCategory, selectedSubcategory, searchQuery, workouts]);

  const hasActiveFilters = selectedDuration || selectedCategory || selectedSubcategory || searchQuery.trim();

  const clearAllFilters = () => {
    setSelectedDuration(null);
    setSelectedCategory(null);
    setSelectedSubcategory(null);
    setSearchQuery('');
  };

  const toggleDuration = (duration) => {
    setSelectedDuration(selectedDuration === duration ? null : duration);
  };

  const toggleCategory = (category) => {
    if (selectedCategory === category) {
      setSelectedCategory(null);
      setSelectedSubcategory(null);
    } else {
      setSelectedCategory(category);
      setSelectedSubcategory(null);
    }
  };

  const toggleSubcategory = (sub) => {
    setSelectedSubcategory(selectedSubcategory === sub ? null : sub);
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    return `${mins} min`;
  };

  const getZoneColor = (power) => {
    if (power <= 0.6) return '#808080';
    if (power <= 0.75) return '#008cff';
    if (power <= 0.89) return '#00d200';
    if (power <= 1.04) return '#ffe600';
    if (power <= 1.18) return '#ff9600';
    return '#ff1e1e';
  };

  const generateChartBars = (chartProfile) => {
    if (!chartProfile || chartProfile.length === 0) {
      return Array(20).fill(null).map(() => ({
        height: 50,
        color: '#008cff'
      }));
    }

    return chartProfile.map((power) => ({
      height: Math.min(100, Math.max(20, (power / 1.5) * 100)),
      color: getZoneColor(power)
    }));
  };

  const handleDeleteCustomWorkout = useCallback(async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Delete this custom workout?')) return;
    setDeletingId(id);
    try {
      await deleteCustomWorkout(id);
      setMyWorkouts(loadCustomWorkouts());
    } catch (err) {
      console.error('Failed to delete workout:', err);
    } finally {
      setDeletingId(null);
    }
  }, []);

  const handleStartRename = useCallback((e, workout) => {
    e.preventDefault();
    e.stopPropagation();
    setRenamingId(workout.id);
    setRenameValue(workout.name);
  }, []);

  const handleConfirmRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && renamingId) {
      renameCustomWorkout(renamingId, trimmed);
      setMyWorkouts(loadCustomWorkouts());
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renameValue, renamingId]);

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
  }, []);

  const handleRenameKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirmRename();
    } else if (e.key === 'Escape') {
      handleCancelRename();
    }
  }, [handleConfirmRename, handleCancelRename]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const durationLabels = { short: '0\u201330 min', medium: '31\u201360 min', long: '60+ min' };
  const isApiUnavailable = apiStatus === 'cached' || apiStatus === 'offline';
  const cachedDate = cachedAt ? new Date(cachedAt) : null;
  const cachedLabel = cachedDate && !Number.isNaN(cachedDate.getTime())
    ? cachedDate.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;
  const showingLocalFallback = apiStatus === 'offline' && workouts.length > 0;

  return (
    <div>
      <TopBar onDeviceScanClick={() => setIsDeviceModalOpen(true)} />

      <main id="main-content" className="main-content">
        <div className="content-wrapper">
          {/* Hero Section */}
          <section className="hero-section">
            <div className="hero-content">
              <h1>My Activities</h1>
              <p className="hero-subtitle">Choose a workout or generate one with AI</p>
            </div>
          </section>

          {/* Tab switcher */}
          <div className="home-tabs">
            <button
              className={`home-tab ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              All Workouts
            </button>
            <button
              className={`home-tab ${activeTab === 'mine' ? 'active' : ''}`}
              onClick={() => { setMyWorkouts(loadCustomWorkouts()); setActiveTab('mine'); }}
            >
              My Workouts
              {myWorkouts.length > 0 && (
                <span className="home-tab-count">{myWorkouts.length}</span>
              )}
            </button>
          </div>

          {/* My Workouts tab */}
          {activeTab === 'mine' && (
            <section className="my-workouts-section">
              {myWorkouts.length === 0 ? (
                <div className="my-workouts-empty">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.25, marginBottom: '1rem' }}>
                    <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
                  </svg>
                  <p>No custom workouts yet</p>
                  <Link to="/ai-workout" className="my-workouts-cta">
                    Generate your first AI workout
                  </Link>
                </div>
              ) : (
                <>
                  <div className="my-workouts-header">
                    <p className="my-workouts-subtitle">Workouts generated with AI, saved to your device</p>
                    <Link to="/ai-workout" className="my-workouts-new-btn">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                      </svg>
                      New
                    </Link>
                  </div>
                  <div className="workouts-grid">
                    {myWorkouts.map(workout => {
                      const bars = generateChartBars(workout.chartProfile);
                      return (
                        <div key={workout.id} className="workout-card-wrapper">
                          <Link
                            to={`/workout/${workout.id}`}
                            className="workout-card"
                          >
                            <div className="workout-card-image">
                              <div className="workout-chart">
                                {bars.map((bar, i) => (
                                  <div
                                    key={i}
                                    className="workout-chart-bar"
                                    style={{ height: `${bar.height}%`, background: bar.color }}
                                  />
                                ))}
                              </div>
                            </div>
                            <div className="workout-card-content">
                              <div className="workout-type">AI Generated</div>
                              {renamingId === workout.id ? (
                                <div className="workout-rename-row" onClick={(e) => e.preventDefault()}>
                                  <input
                                    ref={renameInputRef}
                                    type="text"
                                    className="workout-rename-input"
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onKeyDown={handleRenameKeyDown}
                                    onBlur={handleConfirmRename}
                                    maxLength={80}
                                  />
                                </div>
                              ) : (
                                <h3 className="workout-title">{workout.name}</h3>
                              )}
                              <div className="workout-meta">
                                <div className="workout-meta-item">
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                                  </svg>
                                  {formatDuration(workout.totalDuration)}
                                </div>
                              </div>
                              {workout.description && (
                                <p className="workout-description">
                                  {workout.description.substring(0, 100)}
                                  {workout.description.length > 100 ? '...' : ''}
                                </p>
                              )}
                            </div>
                          </Link>
                          <div className="workout-card-actions">
                            <button
                              className="workout-card-rename"
                              onClick={(e) => handleStartRename(e, workout)}
                              aria-label="Rename workout"
                              title="Rename workout"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                              </svg>
                            </button>
                            <button
                              className={`workout-card-delete ${deletingId === workout.id ? 'deleting' : ''}`}
                              onClick={(e) => handleDeleteCustomWorkout(e, workout.id)}
                              disabled={deletingId === workout.id}
                              aria-label="Delete workout"
                              title="Delete workout"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          )}

          {/* Search & Filters (only shown in All tab) */}
          {activeTab === 'all' && (<>
          {isApiUnavailable && (
            <div className="offline-banner">
              <div className="offline-banner-content">
                <div className="offline-banner-title">Workout library unavailable</div>
                <div className="offline-banner-text">
                  {cachedLabel
                    ? `Showing cached workouts from ${cachedLabel}.`
                    : (showingLocalFallback
                      ? 'No connection to the workout library. Showing your local workouts only.'
                      : 'No connection to the workout library. You can still use My Workouts offline.')}
                </div>
              </div>
              <button className="btn-text" onClick={() => setActiveTab('mine')}>
                My Workouts
              </button>
            </div>
          )}

          {/* Ride History */}
          {rideHistory.length > 0 && (
            <section className="history-section history-section--top">
              <div className="history-header">
                <h2>Finished Workouts</h2>
                <button className="btn-text" onClick={clearHistory}>Clear</button>
              </div>

              <div className="history-list">
                {rideHistory.map(ride => (
                  <div key={ride.id} className="history-item">
                    <div className="history-item-left">
                      <div className="history-name">{ride.workoutName}</div>
                      <div className="history-date">{formatHistoryDate(ride.date)}</div>
                    </div>
                    <div className="history-stats">
                      <div className="history-stat">
                        <span className="history-stat-value">{formatHistoryTime(ride.duration)}</span>
                        <span className="history-stat-label">Time</span>
                      </div>
                      <div className="history-stat">
                        <span className="history-stat-value">{ride.avgPower}<small>W</small></span>
                        <span className="history-stat-label">Avg Power</span>
                      </div>
                      <div className="history-stat">
                        <span className="history-stat-value">{ride.maxPower}<small>W</small></span>
                        <span className="history-stat-label">Max Power</span>
                      </div>
                      <div className="history-stat">
                        <span className="history-stat-value">{(ride.distance / 1000).toFixed(1)}<small>km</small></span>
                        <span className="history-stat-label">Distance</span>
                      </div>
                      <div className="history-stat">
                        <span className="history-stat-value">{ride.calories}<small>kcal</small></span>
                        <span className="history-stat-label">Calories</span>
                      </div>
                      <div className="history-stat">
                        <span className="history-stat-value">{ride.intensityFactor}</span>
                        <span className="history-stat-label">IF</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="workout-filters">
            {/* Search Bar */}
            <div className="filter-search">
              <svg className="filter-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <input
                type="text"
                className="filter-search-input"
                placeholder="Search workouts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="filter-search-clear" onClick={() => setSearchQuery('')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              )}
            </div>

            {/* Category Chips - Horizontal Scrollable */}
            <div className="filter-section">
              <div className="filter-section-header">
                <span className="filter-label">Collection</span>
                {selectedCategory && (
                  <button className="filter-clear-link" onClick={() => { setSelectedCategory(null); setSelectedSubcategory(null); }}>
                    Clear
                  </button>
                )}
              </div>
              <div className="filter-categories-scroll" ref={categoryScrollRef}>
                {categories.map(cat => (
                  <button
                    key={cat}
                    className={`filter-category-chip ${selectedCategory === cat ? 'active' : ''}`}
                    onClick={() => toggleCategory(cat)}
                  >
                    <span className="filter-category-name">{cat}</span>
                    <span className="filter-category-count">{categoryData[cat].count}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Subcategory Pills - Appear when category selected */}
            {selectedCategory && subcategories.length > 0 && (
              <div className="filter-section filter-section-sub">
                <div className="filter-pills">
                  {subcategories.map(([sub, count]) => (
                    <button
                      key={sub}
                      className={`filter-pill ${selectedSubcategory === sub ? 'active' : ''}`}
                      onClick={() => toggleSubcategory(sub)}
                    >
                      {sub}
                      <span className="filter-pill-count">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Duration Filter */}
            <div className="filter-section">
              <span className="filter-label">Duration</span>
              <div className="filter-pills">
                <button
                  className={`filter-pill ${selectedDuration === 'short' ? 'active' : ''}`}
                  onClick={() => toggleDuration('short')}
                >
                  0–30 min
                </button>
                <button
                  className={`filter-pill ${selectedDuration === 'medium' ? 'active' : ''}`}
                  onClick={() => toggleDuration('medium')}
                >
                  31–60 min
                </button>
                <button
                  className={`filter-pill ${selectedDuration === 'long' ? 'active' : ''}`}
                  onClick={() => toggleDuration('long')}
                >
                  60+ min
                </button>
              </div>
            </div>

            {/* Active Filters Bar */}
            {hasActiveFilters && (
              <div className="active-filters-bar">
                <div className="active-filters-list">
                  {selectedCategory && (
                    <span className="active-filter-chip" onClick={() => { setSelectedCategory(null); setSelectedSubcategory(null); }}>
                      {selectedCategory}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </span>
                  )}
                  {selectedSubcategory && (
                    <span className="active-filter-chip" onClick={() => setSelectedSubcategory(null)}>
                      {selectedSubcategory}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </span>
                  )}
                  {selectedDuration && (
                    <span className="active-filter-chip" onClick={() => setSelectedDuration(null)}>
                      {durationLabels[selectedDuration]}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </span>
                  )}
                  {searchQuery.trim() && (
                    <span className="active-filter-chip" onClick={() => setSearchQuery('')}>
                      "{searchQuery}"
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </span>
                  )}
                </div>
                <button className="active-filters-clear" onClick={clearAllFilters}>
                  Clear all
                </button>
              </div>
            )}
          </section>

          {/* Results Count */}
          <div className="results-count">
            {filteredWorkouts.length} {filteredWorkouts.length === 1 ? 'workout' : 'workouts'}
            {hasActiveFilters && ` of ${workouts.length}`}
          </div>

          {/* Workouts Grid */}
          <section className="workouts-section">
            <div className="workouts-grid">
              {filteredWorkouts.map(workout => {
                const bars = generateChartBars(workout.chartProfile);
                return (
                  <Link
                    key={workout.id}
                    to={`/workout/${workout.id}`}
                    className="workout-card"
                  >
                    <div className="workout-card-image">
                      <div className="workout-chart">
                        {bars.map((bar, i) => (
                          <div
                            key={i}
                            className="workout-chart-bar"
                            style={{ height: `${bar.height}%`, background: bar.color }}
                          ></div>
                        ))}
                      </div>
                    </div>
                    <div className="workout-card-content">
                      {workout.category && (
                        <div className="workout-type">{workout.category}{workout.subcategory ? ` \u203A ${workout.subcategory}` : ''}</div>
                      )}
                      <h3 className="workout-title">{workout.name}</h3>
                      <div className="workout-meta">
                        <div className="workout-meta-item">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                          </svg>
                          {formatDuration(workout.totalDuration)}
                        </div>
                      </div>
                      {workout.description && (
                        <p className="workout-description">
                          {workout.description.substring(0, 100)}
                          {workout.description.length > 100 ? '...' : ''}
                        </p>
                      )}
                      {workout.tags && workout.tags.length > 0 && (
                        <div className="workout-tags">
                          {workout.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="workout-tag">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
              {filteredWorkouts.length === 0 && (
                <div className="empty-state">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.3, marginBottom: '1rem' }}>
                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                  </svg>
                  {isApiUnavailable ? (
                    <>
                      <p>Workout library is offline right now.</p>
                      <button className="empty-state-clear" onClick={() => setActiveTab('mine')}>
                        Go to My Workouts
                      </button>
                    </>
                  ) : (
                    <>
                      <p>No workouts match your filters</p>
                      <button className="empty-state-clear" onClick={clearAllFilters}>Clear all filters</button>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>

          </>)}
        </div>
      </main>

      <DeviceModal isOpen={isDeviceModalOpen} onClose={() => setIsDeviceModalOpen(false)} />
    </div>
  );
}
