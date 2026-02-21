import React, { useEffect, useRef } from 'react';
import { useAnt } from '../contexts/AntContext';

// ── Icons ─────────────────────────────────────────────────────────────────────

function AntPlusIcon() {
  // Stylised "ANT+" broadcast signal icon
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="2"/>
      <path d="M12 6c-3.87 0-7 3.13-7 7h2c0-2.76 2.24-5 5-5s5 2.24 5 5h2c0-3.87-3.13-7-7-7z"/>
      <path d="M12 2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8s8 3.59 8 8h2c0-5.52-4.48-10-10-10z"/>
    </svg>
  );
}

function BluetoothIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z"/>
    </svg>
  );
}

function BackArrowIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
    </svg>
  );
}

// ── Empty-state signal graphic ────────────────────────────────────────────────

function SignalGraphic() {
  return (
    <svg width="80" height="80" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 6c-3.87 0-7 3.13-7 7h2c0-2.76 2.24-5 5-5s5 2.24 5 5h2c0-3.87-3.13-7-7-7z"/>
      <path d="M12 2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8s8 3.59 8 8h2c0-5.52-4.48-10-10-10z"/>
    </svg>
  );
}

// ── DeviceModal ───────────────────────────────────────────────────────────────

export default function DeviceModal({ isOpen, onClose }) {
  const {
    status,
    isScanning,
    discoveredDevices,
    connectedDevice,
    connectionType,
    setConnectionType,
    initialize,
    startScan,
    stopScan,
    connect,
    disconnect,
  } = useAnt();

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleStartScan = async () => {
    try {
      if (status === 'disconnected') await initialize();
      await startScan();
    } catch (err) {
      console.error('Failed to start scan:', err);
    }
  };

  const handleStopScan = async () => {
    try {
      await stopScan();
    } catch (err) {
      console.error('Failed to stop scan:', err);
    }
  };

  const handleConnect = async (deviceId) => {
    try {
      await connect(deviceId);
      setTimeout(() => onClose(), 400);
    } catch (err) {
      console.error('Failed to connect:', err);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  };

  const handleTabChange = (type) => {
    if (type === connectionType) return;
    setConnectionType(type);
  };

  const modalRef = useRef(null);

  // ── Focus trap and Escape key handler ──────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    const modal = modalRef.current;
    if (!modal) return;

    // Move focus into the modal on open
    const focusableSelectors = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
    const focusables = modal.querySelectorAll(focusableSelectors);
    if (focusables.length) focusables[0].focus();

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusableList = Array.from(modal.querySelectorAll(focusableSelectors));
      if (focusableList.length === 0) return;
      const first = focusableList[0];
      const last = focusableList[focusableList.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // ── Derived display values ─────────────────────────────────────────────────

  const isBluetooth   = connectionType === 'bluetooth';
  const isAntPlus     = !isBluetooth;

  const dongleLabel   = isBluetooth ? 'Bluetooth' : 'Dongle';
  const dongleText    = (status === 'scanning' || status === 'connected') ? 'Ready' : 'Disconnected';
  const dongleClass   = (status === 'scanning' || status === 'connected') ? 'connected' : 'disconnected';

  const scanStatusText  = isScanning ? (isBluetooth ? 'Searching…' : 'Scanning') : 'Idle';
  const scanStatusClass = isScanning ? 'scanning' : 'idle';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="modal active" role="dialog" aria-modal="true" aria-labelledby="device-modal-title" ref={modalRef}>
      <div className="modal-content device-scan">

        {/* Header */}
        <div className="modal-header">
          <button className="back-button" onClick={onClose} aria-label="Close">
            <BackArrowIcon />
          </button>
          <h2 id="device-modal-title">Connect Trainer</h2>
          <div />
        </div>

        {/* Connection-type tabs */}
        <div className="conn-type-tabs" role="tablist" aria-label="Connection type">
          <button
            role="tab"
            aria-selected={isAntPlus}
            className={`conn-type-tab ${isAntPlus ? 'active' : ''}`}
            onClick={() => handleTabChange('ant+')}
          >
            <AntPlusIcon />
            ANT+
          </button>
          <button
            role="tab"
            aria-selected={isBluetooth}
            className={`conn-type-tab ${isBluetooth ? 'active' : ''}`}
            onClick={() => handleTabChange('bluetooth')}
          >
            <BluetoothIcon />
            Bluetooth
          </button>
        </div>

        <div className="modal-body">

          {/* Status bar */}
          <div className="device-status-bar">
            <div className="status-chip">
              <span className="status-label">{dongleLabel}:</span>
              <span className={`status-value ${dongleClass}`}>{dongleText}</span>
            </div>
            <div className="status-chip">
              <span className="status-label">Status:</span>
              <span className={`status-value ${scanStatusClass}`}>{scanStatusText}</span>
            </div>
          </div>

          {/* ── Bluetooth-specific hint ────────────────────────────────────── */}
          {isBluetooth && (
            <div className="ble-hint">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
              </svg>
              <span>
                {discoveredDevices.length === 0
                  ? 'Click "Find Trainer" — your browser will show a Bluetooth device picker.'
                  : 'Trainer found. Click "Connect" to pair it.'}
              </span>
            </div>
          )}

          {/* Connected device banner — shown when connected but device not in the scan list */}
          {status === 'connected' && connectedDevice &&
           !discoveredDevices.find(d => d.deviceId === connectedDevice.deviceId) && (
            <div className="connected-device-banner">
              <div className="connected-device-info">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                </svg>
                <span>
                  Connected to <strong>{connectedDevice.name || connectedDevice.deviceId}</strong>
                </span>
              </div>
              <button className="btn btn-danger btn-sm" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          )}

          {/* Devices section */}
          <div className="devices-found-section">
            <div className="section-header">
              <h3>
                {discoveredDevices.length === 0
                  ? (isScanning ? 'Searching for devices…' : 'No devices found yet')
                  : `${discoveredDevices.length} device${discoveredDevices.length !== 1 ? 's' : ''} found`}
              </h3>
              {isAntPlus && (
                <div className="scan-actions">
                  <button className="btn-text" onClick={handleStartScan} disabled={isScanning}>
                    RESCAN
                  </button>
                </div>
              )}
            </div>

            {/* Device list */}
            <div className="devices-list">
              {discoveredDevices.length === 0 ? (
                <div className="empty-state">
                  <SignalGraphic />
                  <p>
                    {isBluetooth
                      ? 'Click "Find Trainer" to open the Bluetooth picker'
                      : 'Click "Start Scan" to discover devices'}
                  </p>
                </div>
              ) : (
                discoveredDevices.map(device => {
                  const isConnected = connectedDevice?.deviceId === device.deviceId;
                  const label = device.name || `Device ${device.deviceId}`;
                  const meta  = isBluetooth
                    ? `BLE · ${device.type || 'Bluetooth'}`
                    : `ID: ${device.deviceId} | Type: ${device.type || 'FE-C'}`;
                  return (
                    <div key={device.deviceId} className={`device-item ${isConnected ? 'selected' : ''}`}>
                      <div className="device-info">
                        {isBluetooth && (
                          <span className="device-icon" aria-hidden="true">
                            <BluetoothIcon />
                          </span>
                        )}
                        <div>
                          <div className="device-name">{label}</div>
                          <div className="device-meta">{meta}</div>
                        </div>
                      </div>
                      {isConnected ? (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={handleDisconnect}
                        >
                          Disconnect
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleConnect(device.deviceId)}
                        >
                          Connect
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Scan controls */}
            {isBluetooth ? (
              <div className="scan-controls">
                <button
                  className="btn btn-primary btn-large"
                  onClick={handleStartScan}
                  disabled={isScanning}
                >
                  {isScanning ? 'Searching…' : 'Find Trainer'}
                </button>
              </div>
            ) : (
              <div className="scan-controls">
                <button
                  className="btn btn-primary btn-large"
                  onClick={handleStartScan}
                  disabled={isScanning}
                >
                  Start Scan
                </button>
                <button
                  className="btn btn-secondary btn-large"
                  onClick={handleStopScan}
                  disabled={!isScanning}
                >
                  Stop Scan
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
