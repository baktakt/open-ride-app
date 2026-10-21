/**
 * WebUSB ANT+ Manager - Handles USB dongle and FE-C communication in the browser
 *
 * This replaces the backend WebSocket approach with direct WebUSB communication.
 * Requires Chrome/Edge/Opera browser with WebUSB support.
 */

import { WebUsbStick, FitnessEquipmentSensor, FitnessEquipmentScanner } from 'ant-plus-next';

// Typical road tyre on smooth tarmac (FE-C default is 0.004)
const ROLLING_RESISTANCE_COEFF = 0.004;

/**
 * Simple EventEmitter for browser
 */
class EventEmitter {
  constructor() {
    this.events = {};
  }

  on(event, listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
    return this;
  }

  off(event, listener) {
    if (!this.events[event]) return this;
    this.events[event] = this.events[event].filter(l => l !== listener);
    return this;
  }

  emit(event, ...args) {
    if (this.events[event]) {
      this.events[event].forEach(listener => listener(...args));
    }
  }

  removeAllListeners(event) {
    if (event) {
      delete this.events[event];
    } else {
      this.events = {};
    }
  }
}

export class AntManagerWebUSB extends EventEmitter {
  constructor() {
    super();

    this.stick = null;
    this.scanner = null;
    this.sensor = null;

    this._dongleStatus = 'disconnected';
    this._scanStatus = 'idle';
    this._connectionStatus = 'disconnected';
    this._connectedDeviceId = null;

    this.discoveredDevices = new Map();
    this.pageCounters = new Map();
  }

  // Getters for status
  get dongleStatus() {
    return this._dongleStatus;
  }

  get scanStatus() {
    return this._scanStatus;
  }

  get connectionStatus() {
    return this._connectionStatus;
  }

  get connectedDeviceId() {
    return this._connectedDeviceId;
  }

  /**
   * Initialize the ANT+ USB dongle using WebUSB
   * This will trigger browser's USB device picker (or reuse existing permissions)
   */
  async initialize() {
    this.log('info', 'Initializing WebUSB ANT+ manager...');

    this.setDongleStatus('connecting');

    try {
      // Create WebUsbStick - will reuse permissions if already granted
      this.stick = new WebUsbStick();

      const opened = await this.openStick();
      if (opened) {
        this.log('info', 'WebUSB stick opened successfully');
        this.setDongleStatus('connected');

        // Store connection state for auto-reconnect
        localStorage.setItem('openride_was_connected', 'true');
        return true;
      }
    } catch (err) {
      this.log('error', `Failed to open USB stick: ${err.message}`);
      console.error('USB error details:', err);
    }

    this.setDongleStatus('error');
    this.log('error', 'No ANT+ USB stick selected. Please try again and select your ANT+ dongle.');

    // Clear connection state
    localStorage.removeItem('openride_was_connected');
    return false;
  }

  /**
   * Open the USB stick with proper error handling
   */
  async openStick() {
    if (!this.stick) return false;

    return new Promise((resolve) => {
      const stick = this.stick;
      let resolved = false;

      // Set up event handlers
      stick.on('startup', () => {
        if (!resolved) {
          resolved = true;
          this.log('info', 'USB stick startup complete');
          resolve(true);
        }
      });

      stick.on('shutdown', () => {
        this.log('info', 'USB stick shutdown');
        this.setDongleStatus('disconnected');
        this.setScanStatus('idle');
        this.setConnectionStatus('disconnected');
      });

      // Add error handler
      stick.on('error', (err) => {
        this.log('error', `USB stick error: ${err.message}`);
        console.error('USB stick error details:', err);
      });

      // Try to open
      stick.open().then((result) => {
        if (!result && !resolved) {
          resolved = true;
          this.log('error', 'stick.open() returned false');
          resolve(false);
        }
      }).catch((err) => {
        if (!resolved) {
          resolved = true;
          this.log('error', `stick.open() threw: ${err.message}`);
          resolve(false);
        }
      });

      // Timeout for startup
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.log('error', 'stick.open() timed out');
          resolve(false);
        }
      }, 5000);
    });
  }

  /**
   * Start scanning for FE-C devices
   */
  async startScan() {
    if (!this.stick || this._dongleStatus !== 'connected') {
      this.log('error', 'Cannot scan: dongle not connected');
      return false;
    }

    if (this._scanStatus === 'scanning') {
      this.log('info', 'Already scanning');
      return true;
    }

    // Stop any existing sensor connection
    if (this._connectionStatus === 'connected') {
      await this.disconnect();
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Clean up previous scanner
    if (this.scanner) {
      this.log('info', 'Cleaning up previous scanner...');
      try {
        this.scanner.removeAllListeners();
        await this.scanner.detach();
      } catch (err) {
        this.log('warn', `Scanner cleanup error (ignored): ${err.message}`);
      }
      this.scanner = null;
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    this.log('info', 'Starting FE-C device scan...');
    this.discoveredDevices.clear();

    try {
      this.scanner = new FitnessEquipmentScanner(this.stick);

      // Handle discovered devices
      this.scanner.on('fitnessData', (state) => {
        this.handleScanData(state);
      });

      this.scanner.on('attached', () => {
        this.log('info', 'Scanner attached to channel - listening for devices...');
        this.log('info', 'Make sure your trainer is powered on and transmitting!');
        this.setScanStatus('scanning');
      });

      this.scanner.on('detached', () => {
        this.log('info', 'Scanner detached from channel');
        this.setScanStatus('stopped');
      });

      this.scanner.on('error', (err) => {
        this.log('error', `Scanner error: ${err.message}`);
        console.error('Scanner error details:', err);
      });

      // Start scanning
      this.log('info', 'Calling scanner.scan()...');
      await this.scanner.scan();

      this.log('info', 'Scan started successfully');
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    } catch (err) {
      this.log('error', `Failed to start scan: ${err.message}`);
      console.error('Scan error details:', err);
      this.scanner = null;
      this.setScanStatus('stopped');
      return false;
    }
  }

  /**
   * Stop scanning
   */
  async stopScan() {
    if (this.scanner) {
      this.log('info', 'Stopping scan...');
      try {
        this.scanner.removeAllListeners();
        await this.scanner.detach();
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        this.log('warn', `Error during scanner detach: ${err.message}`);
      }
      this.scanner = null;
    }
    this.setScanStatus('stopped');
  }

  /**
   * Handle scan data - update discovered devices
   */
  handleScanData(state) {
    // Called for every broadcast (~4 Hz per trainer) — keep it cheap
    const deviceId = state.DeviceId;
    if (!deviceId) return;

    const device = {
      deviceId,
      deviceType: 17, // FE-C device type
      transmissionType: 0,
      timestamp: Date.now(),
    };

    const isNew = !this.discoveredDevices.has(deviceId);
    this.discoveredDevices.set(deviceId, device);

    if (isNew) {
      this.log('info', `Discovered FE-C device: ${deviceId} (${state.EquipmentType || 'unknown type'})`);
      this.emit('device_discovered', device);
    }

    // Emit scan telemetry for real-time updates
    const telemetry = this.scanStateToTelemetry(state);
    this.emit('scan_telemetry', telemetry);
  }

  /**
   * Connect to a specific device
   */
  async connect(deviceId) {
    if (!this.stick || this._dongleStatus !== 'connected') {
      this.log('error', 'Cannot connect: dongle not connected');
      return false;
    }

    if (this._connectionStatus === 'connected') {
      if (this._connectedDeviceId === deviceId) {
        this.log('info', `Already connected to device ${deviceId}`);
        return true;
      }
      await this.disconnect();
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Stop scanning if active
    if (this._scanStatus === 'scanning') {
      await this.stopScan();
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    this.log('info', `Connecting to device ${deviceId}...`);
    this.setConnectionStatus('connecting');
    this.pageCounters.clear();

    try {
      this.sensor = new FitnessEquipmentSensor(this.stick);

      // Handle telemetry data
      this.sensor.on('fitnessData', (state) => {
        this.handleTelemetry(state);
      });

      this.sensor.on('attached', () => {
        this.log('info', `Sensor attached to device ${deviceId}`);
        this._connectedDeviceId = deviceId;
        this.setConnectionStatus('connected');
      });

      this.sensor.on('detached', () => {
        this.log('info', 'Sensor detached');
        this.setConnectionStatus('disconnected');
        this._connectedDeviceId = null;
      });

      this.sensor.on('error', (err) => {
        this.log('error', `Sensor error: ${err.message}`);
        console.error('Sensor error details:', err);
      });

      // Attach to specific device (channel 0, deviceId)
      await this.sensor.attach(0, deviceId);

      this.log('info', `Connected to device ${deviceId}`);
      return true;
    } catch (err) {
      this.log('error', `Failed to connect: ${err.message}`);
      this.setConnectionStatus('disconnected');
      return false;
    }
  }

  /**
   * Disconnect from current device
   */
  async disconnect() {
    if (this.sensor) {
      this.log('info', 'Disconnecting...');
      try {
        this.sensor.removeAllListeners();
        await this.sensor.detach();
      } catch (err) {
        this.log('warn', `Error during sensor detach: ${err.message}`);
      }
      this.sensor = null;
    }
    this._connectedDeviceId = null;
    this.setConnectionStatus('disconnected');
  }

  /**
   * Handle telemetry data from connected sensor
   */
  handleTelemetry(state) {
    const telemetry = this.stateToTelemetry(state);

    // Track page counters for debugging
    if (state.ElapsedTime !== undefined) {
      this.incrementPageCounter('0x10');
    }
    if (state.Cadence !== undefined || state.InstantaneousPower !== undefined) {
      this.incrementPageCounter('0x19');
    }

    telemetry.pagesReceived = Object.fromEntries(this.pageCounters);

    this.emit('telemetry', telemetry);
  }

  /**
   * Convert sensor state to telemetry data
   */
  stateToTelemetry(state) {
    // Convert speed from m/s to km/h
    const speedMs = state.RealSpeed ?? state.VirtualSpeed;
    const speedKmh = speedMs !== undefined ? speedMs * 3.6 : undefined;

    return {
      timestamp: Date.now(),
      deviceId: state.DeviceId || 0,

      // General FE Data
      equipmentType: undefined,
      equipmentTypeName: state.EquipmentType || 'Unknown',
      elapsedTime: state.ElapsedTime,
      distance: state.Distance,
      speed: speedKmh,
      heartRate: state.HeartRate,
      heartRateSource: state.HeartRateSource,

      // General Settings
      cycleLength: state.CycleLength,
      incline: state.Incline,
      resistance: state.Resistance,

      // Trainer Data
      eventCount: state._EventCount0x19,
      instantaneousCadence: state.Cadence,
      instantaneousPower: state.InstantaneousPower,
      accumulatedPower: state.AccumulatedPower,

      // Status
      trainerStatus: state.TrainerStatus,
      trainerStatusFlags: this.parseTrainerStatus(state.TrainerStatus),
    };
  }

  /**
   * Convert scan state to telemetry data
   */
  scanStateToTelemetry(state) {
    // Convert speed from m/s to km/h
    const speedMs = state.RealSpeed ?? state.VirtualSpeed;
    const speedKmh = speedMs !== undefined ? speedMs * 3.6 : undefined;

    return {
      timestamp: Date.now(),
      deviceId: state.DeviceId || 0,

      // General FE Data
      equipmentType: undefined,
      equipmentTypeName: state.EquipmentType || 'Unknown',
      elapsedTime: state.ElapsedTime,
      distance: state.Distance,
      speed: speedKmh,
      heartRate: state.HeartRate,
      heartRateSource: state.HeartRateSource,

      // General Settings
      cycleLength: state.CycleLength,
      incline: state.Incline,
      resistance: state.Resistance,

      // Trainer Data
      eventCount: state._EventCount0x19,
      instantaneousCadence: state.Cadence,
      instantaneousPower: state.InstantaneousPower,
      accumulatedPower: state.AccumulatedPower,

      // Status
      trainerStatus: state.TrainerStatus,
      trainerStatusFlags: this.parseTrainerStatus(state.TrainerStatus),
    };
  }

  /**
   * Parse trainer status flags
   */
  parseTrainerStatus(status) {
    if (status === undefined) return [];

    const flags = [];
    if (status & 0x01) flags.push('Bicycle Power Calibration Required');
    if (status & 0x02) flags.push('Resistance Calibration Required');
    if (status & 0x04) flags.push('User Configuration Required');
    return flags;
  }

  /**
   * Increment page counter for debugging
   */
  incrementPageCounter(page) {
    const count = this.pageCounters.get(page) || 0;
    this.pageCounters.set(page, count + 1);
  }

  /**
   * Set target power (ERG mode)
   */
  async setTargetPower(power) {
    if (!this.sensor || this._connectionStatus !== 'connected') {
      this.log('error', 'Cannot set power: not connected');
      return false;
    }

    // Clamp to valid range (0-4000W)
    power = Math.max(0, Math.min(4000, Math.round(power)));

    this.log('info', `Setting target power to ${power}W`);

    try {
      await this.sensor.setTargetPower(power);
      this.log('info', `Target power set to ${power}W`);
      return true;
    } catch (err) {
      this.log('error', `Failed to set target power: ${err.message}`);
      return false;
    }
  }

  /**
   * Set basic resistance
   */
  async setResistance(percent) {
    if (!this.sensor || this._connectionStatus !== 'connected') {
      this.log('error', 'Cannot set resistance: not connected');
      return false;
    }

    // Clamp to valid range (0-100%)
    percent = Math.max(0, Math.min(100, percent));

    this.log('info', `Setting resistance to ${percent}%`);

    try {
      await this.sensor.setBasicResistance(percent);
      this.log('info', `Resistance set to ${percent}%`);
      return true;
    } catch (err) {
      this.log('error', `Failed to set resistance: ${err.message}`);
      return false;
    }
  }

  /**
   * Grade simulation via FE-C Track Resistance (data page 51). The trainer
   * computes resistance from grade, rolling resistance and the rider weight
   * from its user configuration.
   * @param {number} gradePercent — e.g. 5 = 5 % uphill, -3 = 3 % downhill
   */
  async setGrade(gradePercent) {
    if (!this.sensor || this._connectionStatus !== 'connected') {
      this.log('error', 'Cannot set grade: not connected');
      return false;
    }

    const grade = Math.max(-20, Math.min(20, gradePercent));
    try {
      await this.sensor.setTrackResistance(grade, ROLLING_RESISTANCE_COEFF);
      this.log('info', `Grade set to ${grade.toFixed(1)}%`);
      return true;
    } catch (err) {
      this.log('error', `Failed to set grade: ${err.message}`);
      return false;
    }
  }

  /**
   * Return a snapshot of current status (used when re-subscribing after tab switch).
   */
  getStatus() {
    return {
      dongle:            this._dongleStatus,
      scan:              this._scanStatus,
      connection:        this._connectionStatus,
      connectedDeviceId: this._connectedDeviceId,
    };
  }

  /**
   * Get list of discovered devices
   */
  getDiscoveredDevices() {
    return Array.from(this.discoveredDevices.values());
  }

  /**
   * Shutdown manager and release resources
   */
  async shutdown() {
    this.log('info', 'Shutting down ANT+ manager...');

    await this.disconnect();
    await this.stopScan();

    if (this.stick) {
      try {
        await this.stick.close();
      } catch {
        // Ignore close errors
      }
      this.stick = null;
    }

    this.setDongleStatus('disconnected');

    // Clear connection state
    localStorage.removeItem('openride_was_connected');

    this.log('info', 'ANT+ manager shutdown complete');
  }

  // Status setters that emit events
  setDongleStatus(status) {
    this._dongleStatus = status;
    this.emitStatus();
  }

  setScanStatus(status) {
    this._scanStatus = status;
    this.emitStatus();
  }

  setConnectionStatus(status) {
    this._connectionStatus = status;
    this.emitStatus();
  }

  emitStatus() {
    this.emit('status', {
      dongle: this._dongleStatus,
      scan: this._scanStatus,
      connection: this._connectionStatus,
      connectedDeviceId: this._connectedDeviceId,
    });
  }

  /**
   * Log helper that also emits log events
   */
  log(level, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    console.log(logMessage);
    this.emit('log', { level, message, timestamp });
  }
}
