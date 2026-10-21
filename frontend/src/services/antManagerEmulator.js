/**
 * ANT+ Manager Emulator for Frontend
 * Simulates ANT+ devices without requiring physical hardware
 * Useful for development and testing
 */

import { speedFromPower } from './cyclingPhysics.js';

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

/**
 * Emulated trainer device
 */
class EmulatedTrainer {
  constructor(deviceId, name) {
    this.deviceId = deviceId;
    this.name = name;

    // Simulated state
    this.mode = 'idle'; // 'idle' | 'erg' | 'resistance' | 'grade'
    this.targetPower = 0;
    this.resistance = 0;
    this.grade = 0;
    this.currentPower = 0;
    this.cadence = 0;
    this.speed = 0;
    this.heartRate = 0;
    this.distance = 0;
    this.elapsedTime = 0;
    this.accumulatedPower = 0;

    // Physics simulation
    this.inertia = 0.95;
    this.noise = 5;
  }

  /**
   * Update simulated telemetry (called every 250ms)
   */
  update() {
    // Smooth power towards what the emulated rider produces in each mode
    if (this.mode === 'erg' && this.targetPower > 0) {
      this.currentPower += (this.targetPower - this.currentPower) * 0.1;
    } else if (this.mode === 'resistance' && this.resistance > 0) {
      this.currentPower = 100 + (this.resistance / 100) * 200;
    } else if (this.mode === 'grade') {
      // Rider pushes harder uphill and eases off downhill
      const riderPower = Math.max(60, Math.min(320, 170 + this.grade * 15));
      this.currentPower += (riderPower - this.currentPower) * 0.1;
    } else {
      // Coast down
      this.currentPower *= 0.95;
    }

    // Add some realistic noise
    this.currentPower += (Math.random() - 0.5) * this.noise;
    this.currentPower = Math.max(0, this.currentPower);

    // Simulate cadence (60-95 rpm when pedaling)
    if (this.currentPower > 20) {
      this.cadence = 65 + Math.random() * 30;
    } else {
      this.cadence *= 0.9;
    }

    // Calculate speed from power: on a grade use road physics (slower
    // uphill), otherwise a flat-road approximation
    if (this.mode === 'grade') {
      const target = speedFromPower(this.currentPower, this.grade);
      this.speed += (target - this.speed) * 0.1;
    } else if (this.currentPower > 0) {
      // Speed (m/s) ≈ (Power / 200)^(1/3) * 10
      this.speed = Math.pow(this.currentPower / 200, 1/3) * 10;
    } else {
      this.speed *= 0.9;
    }

    // Simulate heart rate (120-180 bpm based on power)
    if (this.currentPower > 0) {
      const targetHr = 100 + (this.currentPower / 300) * 80;
      this.heartRate += (targetHr - this.heartRate) * 0.05;
    } else {
      this.heartRate *= 0.99;
    }

    // Update distance (speed is in m/s, update every 250ms)
    this.distance += this.speed * 0.25;

    // Update elapsed time (in ANT+ time units: 1/4 second)
    this.elapsedTime += 1;

    // Update accumulated power
    this.accumulatedPower += this.currentPower * 0.25;

    return this.getTelemetry();
  }

  /**
   * Get current telemetry
   */
  getTelemetry() {
    return {
      timestamp: Date.now(),
      deviceId: this.deviceId,

      equipmentType: undefined,
      equipmentTypeName: 'Trainer/Stationary Bike',
      elapsedTime: this.elapsedTime,
      distance: this.distance,
      speed: this.speed * 3.6, // Convert m/s to km/h
      heartRate: Math.round(this.heartRate),
      heartRateSource: 'emulated',

      resistance: this.resistance,

      instantaneousCadence: Math.round(this.cadence),
      instantaneousPower: Math.round(this.currentPower),
      accumulatedPower: Math.round(this.accumulatedPower),

      trainerStatus: 0,
      trainerStatusFlags: [],

      pagesReceived: { '0x10': 100, '0x19': 100 },
    };
  }

  setTargetPower(power) {
    this.mode = 'erg';
    this.targetPower = power;
  }

  setResistance(percent) {
    this.mode = 'resistance';
    this.resistance = percent;
  }

  setGrade(gradePercent) {
    this.mode = 'grade';
    this.grade = gradePercent;
  }
}

/**
 * Emulated ANT+ Manager
 */
export class AntManagerEmulator extends EventEmitter {
  constructor() {
    super();

    this._dongleStatus = 'disconnected';
    this._scanStatus = 'idle';
    this._connectionStatus = 'disconnected';
    this._connectedDeviceId = null;

    this.discoveredDevices = new Map();
    this.connectedTrainer = null;
    this.telemetryInterval = null;

    // Create emulated trainers
    this.emulatedTrainers = [
      new EmulatedTrainer(12345, 'Wahoo KICKR CORE'),
      new EmulatedTrainer(54321, 'Wahoo KICKR'),
      new EmulatedTrainer(99999, 'Elite Direto'),
    ];
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
   * Initialize (simulated)
   */
  async initialize() {
    this.log('info', 'Initializing emulated ANT+ manager...');
    this.setDongleStatus('connecting');

    await new Promise(resolve => setTimeout(resolve, 500));

    this.setDongleStatus('connected');
    this.log('info', 'Emulated ANT+ manager ready!');
    return true;
  }

  /**
   * Start scanning (simulated)
   */
  async startScan() {
    if (this._scanStatus === 'scanning') {
      this.log('info', 'Already scanning');
      return true;
    }

    this.log('info', 'Starting emulated scan...');
    this.discoveredDevices.clear();
    this.setScanStatus('scanning');

    // Discover devices one by one with delays
    for (const trainer of this.emulatedTrainers) {
      await new Promise(resolve => setTimeout(resolve, 300));

      const device = {
        deviceId: trainer.deviceId,
        deviceType: 17,
        transmissionType: 0,
        timestamp: Date.now(),
      };

      this.discoveredDevices.set(trainer.deviceId, device);
      this.log('info', `Discovered emulated device: ${trainer.name} (${trainer.deviceId})`);
      this.emit('device_discovered', device);

      // Also emit scan telemetry
      this.emit('scan_telemetry', trainer.getTelemetry());
    }

    this.log('info', `Scan complete - found ${this.emulatedTrainers.length} emulated trainers`);
    return true;
  }

  /**
   * Stop scanning
   */
  async stopScan() {
    this.log('info', 'Stopping emulated scan...');
    this.setScanStatus('stopped');
  }

  /**
   * Connect to device (simulated)
   */
  async connect(deviceId) {
    const trainer = this.emulatedTrainers.find(t => t.deviceId === deviceId);
    if (!trainer) {
      this.log('error', `Emulated device ${deviceId} not found`);
      return false;
    }

    this.log('info', `Connecting to emulated device ${trainer.name}...`);
    this.setConnectionStatus('connecting');

    await new Promise(resolve => setTimeout(resolve, 500));

    this.connectedTrainer = trainer;
    this._connectedDeviceId = deviceId;
    this.setConnectionStatus('connected');

    // Start telemetry updates (every 250ms like real ANT+)
    this.telemetryInterval = setInterval(() => {
      const telemetry = this.connectedTrainer.update();
      this.emit('telemetry', telemetry);
    }, 250);

    this.log('info', `Connected to ${trainer.name}`);
    return true;
  }

  /**
   * Disconnect
   */
  async disconnect() {
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }

    this.connectedTrainer = null;
    this._connectedDeviceId = null;
    this.setConnectionStatus('disconnected');
    this.log('info', 'Disconnected from emulated trainer');
  }

  /**
   * Set target power
   */
  async setTargetPower(power) {
    if (!this.connectedTrainer) {
      this.log('error', 'Cannot set power: not connected');
      return false;
    }

    power = Math.max(0, Math.min(4000, Math.round(power)));
    this.log('info', `Setting emulated target power to ${power}W`);
    this.connectedTrainer.setTargetPower(power);
    return true;
  }

  /**
   * Set resistance
   */
  async setResistance(percent) {
    if (!this.connectedTrainer) {
      this.log('error', 'Cannot set resistance: not connected');
      return false;
    }

    percent = Math.max(0, Math.min(100, percent));
    this.log('info', `Setting emulated resistance to ${percent}%`);
    this.connectedTrainer.setResistance(percent);
    return true;
  }

  /**
   * Grade simulation: the emulated rider's speed follows road physics.
   * @param {number} gradePercent
   */
  async setGrade(gradePercent) {
    if (!this.connectedTrainer) {
      this.log('error', 'Cannot set grade: not connected');
      return false;
    }

    const grade = Math.max(-20, Math.min(20, gradePercent));
    this.log('info', `Setting emulated grade to ${grade.toFixed(1)}%`);
    this.connectedTrainer.setGrade(grade);
    return true;
  }

  /**
   * Get discovered devices
   */
  getDiscoveredDevices() {
    return Array.from(this.discoveredDevices.values());
  }

  /**
   * Shutdown
   */
  async shutdown() {
    this.log('info', 'Shutting down emulated ANT+ manager...');
    await this.disconnect();
    this.setDongleStatus('disconnected');
  }

  // Status setters
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
   * Log helper
   */
  log(level, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] [EMULATOR] ${message}`;
    console.log(logMessage);
    this.emit('log', { level, message, timestamp });
  }
}
