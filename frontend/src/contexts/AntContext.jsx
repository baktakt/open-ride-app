import React, { useContext, useState, useEffect, useCallback, useRef } from 'react';
import { ANT_DEVICE_KEY, EMULATOR_DEVICE_KEY, recoverRideTrainer, restoreTrainerSession } from '../services/trainerSession';
import { getAntManager, isEmulatorMode } from '../services/antManager';
import { BluetoothManagerWebBluetooth } from '../services/bluetoothManagerWebBluetooth';
import { HeartRateMonitorWebBluetooth } from '../services/heartRateMonitorWebBluetooth';
import { EMPTY_TELEMETRY, mergeTelemetry } from '../services/telemetry';

import { AntContext } from './contextObjects';

export function useAnt() {
  const context = useContext(AntContext);
  if (!context) {
    throw new Error('useAnt must be used within AntProvider');
  }
  return context;
}

export function AntProvider({ children }) {
  // Both managers are created once and kept alive for the session.
  const [antManager]       = useState(() => getAntManager());
  const deviceKey = isEmulatorMode() ? EMULATOR_DEVICE_KEY : ANT_DEVICE_KEY;
  const [bluetoothManager] = useState(() => new BluetoothManagerWebBluetooth());
  // Optional Bluetooth heart rate strap, usable with either trainer connection
  const [heartRateMonitor] = useState(() => new HeartRateMonitorWebBluetooth());
  const [heartRateMonitorStatus, setHeartRateMonitorStatus] = useState(() => heartRateMonitor.getStatus());
  const hrmConnectedRef = useRef(false);

  // Connection type: 'ant+' | 'bluetooth' — persisted in localStorage
  const [connectionType, _setConnectionType] = useState(
    () => localStorage.getItem('openride_connection_type') || 'ant+'
  );

  // Tracks whether a workout is actively in progress (used to protect the rider profile during a session)
  const [workoutActive, setWorkoutActive] = useState(false);

  // Shared UI state
  const [status,            setStatus]            = useState('disconnected');
  const [isScanning,        setIsScanning]        = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [connectedDevice,   setConnectedDevice]   = useState(null);
  const [telemetry,         setTelemetry]         = useState(EMPTY_TELEMETRY);
  const [trainerSignalFresh, setTrainerSignalFresh] = useState(false);
  const telemetryLastSeenRef = useRef({});

  // Ref so event handlers always access the latest discovered devices without
  // needing to be recreated whenever the list changes.
  const discoveredDevicesRef = useRef([]);
  useEffect(() => { discoveredDevicesRef.current = discoveredDevices; }, [discoveredDevices]);

  // ── Subscribe to the active manager's events ───────────────────────────────
  useEffect(() => {
    const manager = connectionType === 'bluetooth' ? bluetoothManager : antManager;

    let lastPacket = 0;
    setTrainerSignalFresh(false);
    // Reset shared state when switching managers
    setStatus('disconnected');
    setIsScanning(false);
    setDiscoveredDevices([]);
    setConnectedDevice(null);
    setTelemetry(EMPTY_TELEMETRY);
    telemetryLastSeenRef.current = {};

    // Sync current hardware state (e.g. switching back to ANT+ while dongle connected)
    const current = manager.getStatus ? manager.getStatus() : null;
    if (current) applyStatus(current);

    function applyStatus(statusObj) {
      if (statusObj.connection === 'connected') {
        setStatus('connected');
        if (statusObj.connectedDeviceId != null) {
          if (connectionType === 'ant+') localStorage.setItem(deviceKey, String(statusObj.connectedDeviceId));
          setConnectedDevice({
            deviceId: statusObj.connectedDeviceId,
            name:     statusObj.connectedDeviceName || null,
          });
        }
      } else if (statusObj.connection === 'disconnected' || statusObj.connection === 'connecting') {
        if (statusObj.connection !== 'connecting') {
          lastPacket = 0;
          setTrainerSignalFresh(false);
          setConnectedDevice(null);
          setTelemetry(EMPTY_TELEMETRY);
          telemetryLastSeenRef.current = {};
        }
        setStatus(statusObj.dongle === 'connected' ? 'scanning' : 'disconnected');
      }
      setIsScanning(statusObj.scan === 'scanning');
    }

    const handleStatus = (statusObj) => {
      console.log(`[AntContext] Status (${connectionType}):`, statusObj);
      applyStatus(statusObj);
    };

    const handleDeviceDiscovered = (device) => {
      console.log(`[AntContext] Device discovered (${connectionType}):`, device);
      setDiscoveredDevices(prev => {
        if (prev.find(d => d.deviceId === device.deviceId)) return prev;
        return [...prev, device];
      });
    };

    const handleTelemetry = (data) => {
      const now = Date.now();
      lastPacket = now;
      setTrainerSignalFresh(true);
      // A dedicated heart rate strap takes precedence over trainer-relayed HR
      const merged = hrmConnectedRef.current ? { ...data, heartRate: undefined } : data;
      setTelemetry(prev => mergeTelemetry(prev, merged, telemetryLastSeenRef.current, now));
    };

    const watchdog = setInterval(() => {
      if (lastPacket && Date.now() - lastPacket > 5000) {
        lastPacket = 0;
        setTrainerSignalFresh(false);
        setTelemetry(prev => mergeTelemetry(prev, {}, telemetryLastSeenRef.current, Date.now()));
      }
    }, 1000);
    manager.on('status',           handleStatus);
    manager.on('device_discovered', handleDeviceDiscovered);
    manager.on('telemetry',         handleTelemetry);

    return () => {
      clearInterval(watchdog);
      manager.off('status',           handleStatus);
      manager.off('device_discovered', handleDeviceDiscovered);
      manager.off('telemetry',         handleTelemetry);
    };
  }, [connectionType, antManager, bluetoothManager, deviceKey]);

  // ── Heart rate strap ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleStatus = (statusObj) => {
      hrmConnectedRef.current = statusObj.connection === 'connected';
      setHeartRateMonitorStatus(statusObj);
    };
    const handleTelemetry = (data) => {
      const now = Date.now();
      setTelemetry(prev => mergeTelemetry(prev, data, telemetryLastSeenRef.current, now));
    };
    heartRateMonitor.on('status', handleStatus);
    heartRateMonitor.on('telemetry', handleTelemetry);
    return () => {
      heartRateMonitor.off('status', handleStatus);
      heartRateMonitor.off('telemetry', handleTelemetry);
    };
  }, [heartRateMonitor]);

  const connectHeartRateMonitor = useCallback(() => heartRateMonitor.connect(), [heartRateMonitor]);
  const disconnectHeartRateMonitor = useCallback(() => heartRateMonitor.disconnect(), [heartRateMonitor]);

  // Restore a granted dongle and its last trainer once, independently of page navigation.
  useEffect(() => {
    if (connectionType !== 'ant+') return;
    if (isEmulatorMode() || localStorage.getItem('openride_was_connected') === 'true') {
      restoreTrainerSession(antManager, { storage: localStorage, deviceKey }).catch(err => {
        console.error('[AntContext] Could not restore trainer:', err);
      });
    }
  }, [antManager, connectionType, deviceKey]);

  useEffect(() => {
    if (!workoutActive || connectionType !== 'ant+' || deviceKey !== ANT_DEVICE_KEY) return;
    return recoverRideTrainer(antManager, () => localStorage.getItem(deviceKey));
  }, [workoutActive, connectionType, antManager, deviceKey]);

  // ── Helper: resolve the active manager ────────────────────────────────────
  const _activeManager = useCallback(() => {
    return connectionType === 'bluetooth' ? bluetoothManager : antManager;
  }, [connectionType, antManager, bluetoothManager, deviceKey]);

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Switch between 'ant+' and 'bluetooth'.
   * Persists the choice in localStorage so it survives page reloads.
   */
  const setConnectionType = useCallback((type) => {
    if (type !== 'ant+' && type !== 'bluetooth') return;
    localStorage.setItem('openride_connection_type', type);
    _setConnectionType(type);
  }, []);

  const initialize = useCallback(async () => {
    try {
      return await _activeManager().initialize();
    } catch (err) {
      console.error('[AntContext] initialize failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const startScan = useCallback(async () => {
    try {
      await _activeManager().startScan();
    } catch (err) {
      console.error('[AntContext] startScan failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const stopScan = useCallback(async () => {
    try {
      await _activeManager().stopScan();
    } catch (err) {
      console.error('[AntContext] stopScan failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const connect = useCallback(async (deviceId) => {
    try {
      const connected = await _activeManager().connect(deviceId);
      if (connected === false) throw new Error('Could not connect to this trainer. Please try again.');
    } catch (err) {
      console.error('[AntContext] connect failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const disconnect = useCallback(async () => {
    try {
      if (connectionType === 'ant+') localStorage.removeItem(deviceKey);
      await _activeManager().disconnect();
    } catch (err) {
      console.error('[AntContext] disconnect failed:', err);
      throw err;
    }
  }, [_activeManager, connectionType, deviceKey]);

  const setTargetPower = useCallback(async (watts) => {
    try {
      return await _activeManager().setTargetPower(watts);
    } catch (err) {
      console.error('[AntContext] setTargetPower failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const setResistance = useCallback(async (percent) => {
    try {
      return await _activeManager().setResistance(percent);
    } catch (err) {
      console.error('[AntContext] setResistance failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const setGrade = useCallback(async (gradePercent) => {
    try {
      return await _activeManager().setGrade(gradePercent);
    } catch (err) {
      console.error('[AntContext] setGrade failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const value = {
    // State
    trainerSignalFresh,
    workoutActive,
    setWorkoutActive,
    status,
    isScanning,
    discoveredDevices,
    connectedDevice,
    telemetry,
    connectionType,
    heartRateMonitorStatus,
    heartRateMonitorSupported: heartRateMonitor.isSupported,

    // Actions
    setConnectionType,
    initialize,
    startScan,
    stopScan,
    connect,
    disconnect,
    setTargetPower,
    setResistance,
    setGrade,
    connectHeartRateMonitor,
    disconnectHeartRateMonitor,
  };

  return <AntContext.Provider value={value}>{children}</AntContext.Provider>;
}
