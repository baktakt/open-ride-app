/**
 * Web Bluetooth Heart Rate Monitor — connects a chest strap / arm band via the
 * standard Heart Rate Service (0x180D).
 *
 * Independent of the trainer connection, so a Bluetooth strap can be used
 * together with an ANT+ or Bluetooth trainer.
 *
 * Events:
 *   'status'    → { connection: 'disconnected'|'connecting'|'connected', deviceName }
 *   'telemetry' → { timestamp, heartRate }
 *   'log'       → { level, message, timestamp }
 */

import { parseHeartRateMeasurement } from './bleParsers.js';

const HEART_RATE_SERVICE     = 0x180D;
const HEART_RATE_MEASUREMENT = 0x2A37;

// ─── Minimal EventEmitter ────────────────────────────────────────────────────
class EventEmitter {
  constructor() { this._events = {}; }
  on(event, fn) {
    (this._events[event] = this._events[event] || []).push(fn);
    return this;
  }
  off(event, fn) {
    if (this._events[event]) {
      this._events[event] = this._events[event].filter(l => l !== fn);
    }
    return this;
  }
  emit(event, ...args) {
    (this._events[event] || []).forEach(fn => fn(...args));
  }
}

export class HeartRateMonitorWebBluetooth extends EventEmitter {
  constructor() {
    super();
    this._device = null;
    this._measurementChar = null;
    this._connection = 'disconnected';
    this._onMeasurement = this._onMeasurement.bind(this);
    this._onGattDisconnected = this._onGattDisconnected.bind(this);
  }

  get isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  getStatus() {
    return { connection: this._connection, deviceName: this._device?.name || null };
  }

  /**
   * Open the browser's Bluetooth picker filtered to heart rate monitors and
   * connect to the chosen device. Must be called from a user gesture.
   */
  async connect() {
    if (!this.isSupported) {
      this.log('error', 'Web Bluetooth is not supported in this browser');
      return false;
    }

    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [HEART_RATE_SERVICE] }],
      });
    } catch (err) {
      if (err.name !== 'NotFoundError') this.log('error', `requestDevice failed: ${err.message}`);
      return false;
    }

    await this.disconnect();
    this._device = device;
    device.addEventListener('gattserverdisconnected', this._onGattDisconnected);
    this._setConnection('connecting');

    try {
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(HEART_RATE_SERVICE);
      this._measurementChar = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
      await this._measurementChar.startNotifications();
      this._measurementChar.addEventListener('characteristicvaluechanged', this._onMeasurement);
      this._setConnection('connected');
      this.log('info', `Heart rate monitor connected: "${device.name || device.id}"`);
      return true;
    } catch (err) {
      this.log('error', `Heart rate monitor connection failed: ${err.message}`);
      await this.disconnect();
      return false;
    }
  }

  async disconnect() {
    const device = this._device;
    if (this._measurementChar) {
      this._measurementChar.removeEventListener('characteristicvaluechanged', this._onMeasurement);
      try { await this._measurementChar.stopNotifications(); } catch { /* ignore */ }
      this._measurementChar = null;
    }
    if (device) {
      device.removeEventListener('gattserverdisconnected', this._onGattDisconnected);
      if (device.gatt.connected) {
        try { device.gatt.disconnect(); } catch { /* ignore */ }
      }
    }
    this._device = null;
    if (this._connection !== 'disconnected') this._setConnection('disconnected');
  }

  _onMeasurement(event) {
    const heartRate = parseHeartRateMeasurement(event.target.value);
    if (heartRate === undefined) return;
    this.emit('telemetry', { timestamp: Date.now(), heartRate });
  }

  _onGattDisconnected() {
    this.log('info', 'Heart rate monitor disconnected');
    this._measurementChar = null;
    this._device = null;
    this._setConnection('disconnected');
  }

  _setConnection(connection) {
    this._connection = connection;
    this.emit('status', this.getStatus());
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [HRM] [${level.toUpperCase()}] ${message}`);
    this.emit('log', { level, message, timestamp });
  }
}
