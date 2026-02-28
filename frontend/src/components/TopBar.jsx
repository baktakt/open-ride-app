import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAnt } from '../contexts/AntContext';
import logoSvg from '../assets/open-ride-logo.svg';

export default function TopBar({
  variant = 'main',
  title,
  backLabel = 'Exit',
  showConnection = true,
  onDeviceScanClick
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, connectedDevice, connectionType, workoutActive } = useAnt();
  const [pendingNav, setPendingNav] = useState(null);
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
  const [showEmulator, setShowEmulator] = useState(false);

  useEffect(() => {
    if (variant !== 'main') return;
    let isActive = true;

    const loadEmulator = async () => {
      try {
        if (!navigator.onLine) throw new Error('Offline');
        const response = await fetch(`${apiBaseUrl}/api/status`);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = await response.json();
        if (isActive) setShowEmulator(Boolean(data.emulator));
      } catch (error) {
        if (isActive) {
          const fromStorage = localStorage.getItem('openride_use_emulator');
          setShowEmulator(fromStorage === 'true');
        }
      }
    };

    loadEmulator();

    return () => {
      isActive = false;
    };
  }, [variant]);

  // When a workout is running, intercept nav clicks and ask for confirmation
  const guardedNav = useCallback((e, path) => {
    if (!workoutActive) return;
    e.preventDefault();
    setPendingNav(path);
  }, [workoutActive]);

  const confirmLeave = useCallback(() => {
    const path = pendingNav;
    setPendingNav(null);
    navigate(path);
  }, [pendingNav, navigate]);

  const isActive = (path) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    if (path === '/training') {
      return location.pathname.startsWith('/training') || location.pathname === '/route';
    }
    return location.pathname.startsWith(path);
  };

  const isBluetooth = connectionType === 'bluetooth';

  const connectionText = useMemo(() => {
    if (status === 'connected') {
      // For BLE prefer the friendly device name; for ANT+ use the numeric device ID
      const label = connectedDevice?.name || connectedDevice?.deviceId;
      if (label) return `Connected (${label})`;
      return 'Connected';
    }
    return 'Connect Devices';
  }, [status, connectedDevice]);

  if (variant === 'activity') {
    return (
      <nav className="top-nav top-nav--activity" aria-label="Activity navigation">
        <div className="nav-left">
          <Link className="nav-back" to="/">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M19 12H5m7-7-7 7 7 7"/>
            </svg>
            <span>{backLabel}</span>
          </Link>
        </div>
        <div className="nav-center">
          <span className="nav-title">{title || ''}</span>
        </div>
        <div className="nav-right">
          {showConnection && (
            <button type="button" className={`connection-badge ${status === 'connected' ? 'connected' : ''}`} onClick={onDeviceScanClick} aria-label={connectionText}>
              {isBluetooth ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="12" cy="12" r="2"/>
                  <path d="M12 6c-3.87 0-7 3.13-7 7h2c0-2.76 2.24-5 5-5s5 2.24 5 5h2c0-3.87-3.13-7-7-7z"/>
                  <path d="M12 2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8s8 3.59 8 8h2c0-5.52-4.48-10-10-10z"/>
                </svg>
              )}
              <span aria-hidden="true">{connectionText}</span>
            </button>
          )}
        </div>
      </nav>
    );
  }

  return (
    <>
    <nav className="top-nav" aria-label="Main navigation">
      <div className="top-nav-inner">
      <div className="nav-left">
        <Link to="/" className="logo" aria-label="Open Ride home" title="Open Ride">
          <img className="logo-image" src={logoSvg} alt="" width="1024" height="300" />
        </Link>
        <div className="nav-tabs">
          <Link to="/" className={`nav-tab ${isActive('/') ? 'active' : ''}`} aria-current={isActive('/') ? 'page' : undefined} onClick={e => guardedNav(e, '/')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 13h1v7c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-7h1c.55 0 .85-.66.5-1.08l-9-9c-.28-.28-.72-.28-1 0l-9 9c-.35.42-.05 1.08.5 1.08z"/>
            </svg>
            Home
          </Link>
          <Link to="/training" className={`nav-tab ${isActive('/training') ? 'active' : ''}`} aria-current={isActive('/training') ? 'page' : undefined} onClick={e => guardedNav(e, '/training')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/>
            </svg>
            Training
          </Link>
          <Link to="/ai-workout" className={`nav-tab ${isActive('/ai-workout') ? 'active' : ''}`} aria-current={isActive('/ai-workout') ? 'page' : undefined} onClick={e => guardedNav(e, '/ai-workout')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
            </svg>
            AI Workout
          </Link>
          <Link to="/settings" className={`nav-tab ${isActive('/settings') ? 'active' : ''}`} aria-current={isActive('/settings') ? 'page' : undefined} onClick={e => guardedNav(e, '/settings')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
            Settings
          </Link>
        </div>
      </div>
      <div className="nav-right">
        {showEmulator && <div className="emulator-badge-nav" role="status" aria-live="polite">🎮 EMULATOR</div>}
        {showConnection && (
          <button type="button" className={`connection-badge ${status === 'connected' ? 'connected' : ''}`} onClick={onDeviceScanClick} aria-label={connectionText}>
            {isBluetooth ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="12" r="2"/>
                <path d="M12 6c-3.87 0-7 3.13-7 7h2c0-2.76 2.24-5 5-5s5 2.24 5 5h2c0-3.87-3.13-7-7-7z"/>
                <path d="M12 2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8s8 3.59 8 8h2c0-5.52-4.48-10-10-10z"/>
              </svg>
            )}
            <span aria-hidden="true">{connectionText}</span>
          </button>
        )}
      </div>
      </div>
    </nav>

    {/* Mobile bottom tab bar */}
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      <Link to="/" className={`mobile-nav-tab ${isActive('/') ? 'active' : ''}`} aria-current={isActive('/') ? 'page' : undefined} onClick={e => guardedNav(e, '/')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M3 13h1v7c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-7h1c.55 0 .85-.66.5-1.08l-9-9c-.28-.28-.72-.28-1 0l-9 9c-.35.42-.05 1.08.5 1.08z"/>
        </svg>
        <span>Home</span>
      </Link>
      <Link to="/training" className={`mobile-nav-tab ${isActive('/training') ? 'active' : ''}`} aria-current={isActive('/training') ? 'page' : undefined} onClick={e => guardedNav(e, '/training')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/>
        </svg>
        <span>Training</span>
      </Link>
      <Link to="/ai-workout" className={`mobile-nav-tab ${isActive('/ai-workout') ? 'active' : ''}`} aria-current={isActive('/ai-workout') ? 'page' : undefined} onClick={e => guardedNav(e, '/ai-workout')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
        </svg>
        <span>AI Workout</span>
      </Link>
      <Link to="/settings" className={`mobile-nav-tab ${isActive('/settings') ? 'active' : ''}`} aria-current={isActive('/settings') ? 'page' : undefined} onClick={e => guardedNav(e, '/settings')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
        </svg>
        <span>Settings</span>
      </Link>
    </nav>

    {pendingNav && (
      <div
        className="notification-modal show"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm leaving workout"
        aria-describedby="notification-modal-message"
      >
        <div className="notification-modal-backdrop" onClick={() => setPendingNav(null)}></div>
        <div className="notification-modal-content">
          <div className="notification-modal-icon">⚠️</div>
          <div
            id="notification-modal-message"
            className="notification-modal-message"
          >
            Leave workout? Your progress will be lost.
          </div>
          <div className="notification-modal-actions">
            <button className="notification-btn notification-btn-secondary" onClick={() => setPendingNav(null)}>
              Stay
            </button>
            <button className="notification-btn notification-btn-primary" onClick={confirmLeave}>
              Leave
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
