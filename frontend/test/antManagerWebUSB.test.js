import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AntManagerWebUSB } from '../src/services/antManagerWebUSB.js';
import { recoverRideTrainer } from '../src/services/trainerSession.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
class Stick extends EventEmitter {
  writes = [];
  async attach() { return true; }
  async detach() { return true; }
  async canAttach() { return true; }
  async write(data) { this.writes.push(data); }
  event(message, code = 0) { this.emit('read', new Uint8Array([0xa4, 3, 0x40, 0, message, code, 0])); }
}
function fixture() {
  const manager = new AntManagerWebUSB();
  manager.log = () => {};
  const stick = manager.stick = new Stick();
  manager._dongleStatus = 'connected';
  return { manager, stick };
}
async function connected() {
  const result = fixture();
  const pending = result.manager.connect(123);
  await flush(); result.stick.event(0x4b); await flush();
  assert.equal(await pending, true);
  return result;
}

test('USB reinitialization closes the previous driver instead of leaking its claimed interface', async t => {
  const { manager, stick } = fixture();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() {} } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { usb: {} } });
  t.after(() => {
    for (const [name, descriptor] of [['localStorage', previousStorage], ['navigator', previousNavigator]]) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  let closes = 0;
  stick.close = async () => { closes++; };
  manager._dongleStatus = 'error';
  manager.openStick = async () => true;
  assert.equal(await manager.initialize(), true);
  assert.equal(closes, 1);
  assert.notEqual(manager.stick, stick);
});

test('unresponsive channel teardown refuses unsafe channel reuse and requires USB reconnection', async t => {
  const { manager } = await connected();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const command = manager.setTargetPower(150);
  await flush(); t.mock.timers.tick(5000); await command;
  t.mock.timers.tick(1500); await flush();
  assert.equal(manager.dongleStatus, 'error');
  assert.equal(await manager.connect(123, true), false);
});

test('unsolicited channel loss cancels outstanding workload immediately', async () => {
  const { manager, stick } = await connected();
  let result;
  manager.setGrade(5).then(value => { result = value; });
  await flush(); stick.event(0x41); await flush();
  assert.equal(result, false);
  assert.equal(manager.connectionStatus, 'disconnected');
});

test('USB shutdown invalidates the sensor so late channel events cannot resurrect control', async t => {
  const { manager, stick } = await connected();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  stick.open = async () => true;
  const opened = manager.openStick();
  stick.emit('startup'); assert.equal(await opened, true);
  const oldSensor = manager.sensor;
  stick.emit('shutdown');
  assert.equal(manager.sensor, null);
  assert.equal(manager.connectedDeviceId, null);
  oldSensor.emit('attached');
  assert.equal(manager.connectionStatus, 'disconnected');
  assert.equal(await manager.setResistance(20), false);
  assert.equal(stick.listenerCount('read'), 0);
});

test('manual reconnect waits for old channel unassignment before creating a new sensor', async () => {
  const { manager, stick } = await connected();
  let cancelled;
  manager.setTargetPower(150).then(value => { cancelled = value; });
  await flush();
  await manager.disconnect();
  await flush();
  assert.equal(cancelled, false, 'disconnect must not block new controls behind an old ACK timeout');
  const pending = manager.connect(123);
  await flush();
  assert.equal(manager.sensor, null, 'must not reuse channel zero until old sensor is unassigned');
  stick.event(1, 7); await flush();
  stick.event(0x41); await flush();
  stick.event(0x4b); await flush();
  assert.equal(await pending, true);
  assert.equal(stick.listenerCount('read'), 1);
});

test('ACK timeout recovers on a fresh sensor without replaying stale queued workloads', async t => {
  const { manager, stick } = await connected();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopRecovery = recoverRideTrainer(manager, () => 123);
  t.after(stopRecovery);
  const oldSensor = manager.sensor;
  const first = manager.setTargetPower(150);
  const obsolete = manager.setTargetPower(250);
  await flush(); t.mock.timers.tick(5000); await flush();
  assert.equal(await first, false);
  assert.equal(await obsolete, false);
  stick.event(0x41); await flush();
  t.mock.timers.tick(2000); await flush();
  assert.notEqual(manager.sensor, oldSensor);
  assert.equal(manager.connectionStatus, 'connecting');
  stick.event(0x4b); await flush();
  assert.equal(manager.connectionStatus, 'connected');
  assert.equal(stick.listenerCount('read'), 1);
  const current = manager.setTargetPower(175);
  await flush(); stick.event(1, 5);
  assert.equal(await current, true);
  const controls = stick.writes.filter(data => data[2] === 0x4f);
  assert.equal(controls.length, 2, 'old 250W must never leave the abandoned queue');
});

test('real transmit failures still report failure and subsequent commands can recover', async () => {
  const { manager, stick } = await connected();
  const rejected = manager.setResistance(30);
  await flush(); stick.event(1, 6); // EVENT_TRANSFER_TX_FAILED
  assert.equal(await rejected, false);
  assert.equal(manager.connectionStatus, 'connected');
  const retry = manager.setResistance(30);
  await flush(); stick.event(1, 5);
  assert.equal(await retry, true);
});

test('USB write rejection retires the channel and never claims trainer acknowledgement', async t => {
  const { manager, stick } = await connected();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const write = stick.write.bind(stick);
  stick.write = data => data[2] === 0x4f ? Promise.reject(new Error('injected USB disconnect')) : write(data);
  assert.equal(await manager.setGrade(5), false);
  assert.equal(manager.connectionStatus, 'disconnected');
  stick.event(0x41); await flush();
  assert.equal(stick.listenerCount('read'), 0);
});

test('unconfirmed channel open times out and releases its driver slot', async t => {
  const { manager, stick } = fixture();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let detached = 0;
  stick.detach = async () => { detached++; return true; };
  const pending = manager.connect(123);
  await flush(); t.mock.timers.tick(5000);
  assert.equal(await pending, false);
  assert.equal(manager.connectionStatus, 'disconnected');
  assert.equal(manager.sensor, null);
  await flush();
  assert.equal(detached, 1);
  stick.event(1, 7); await flush(); // EVENT_CHANNEL_CLOSED must trigger unassignment
  assert.ok(stick.writes.some(data => data[2] === 0x41), 'failed attach must unassign the hardware channel');
  stick.event(0x41); await flush();
  assert.equal(stick.listenerCount('read'), 0);
});

test('manual disconnect cancels recovery waiting for a retiring channel', async t => {
  const { manager, stick } = await connected();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const command = manager.setTargetPower(150);
  await flush(); t.mock.timers.tick(5000); await command;
  let result;
  manager.connect(123, true).then(value => { result = value; });
  await manager.disconnect();
  stick.event(0x41); await flush();
  assert.equal(result, false);
  assert.equal(manager.sensor, null);
});

test('a missing ACK retires the poisoned channel instead of accumulating commands', async t => {
  const { manager, stick } = await connected();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = manager.setTargetPower(150);
  await flush();
  const oldSensor = manager.sensor;
  t.mock.timers.tick(5000); await flush();
  assert.equal(await pending, false);
  assert.equal(manager.connectionStatus, 'disconnected');
  assert.equal(manager.sensor, null);
  assert.equal(await manager.setTargetPower(250), false);
  oldSensor.emit('fitnessData', { DeviceId: 123 });
  stick.event(0x41); await flush();
  assert.equal(stick.listenerCount('read'), 0);
});

test('latest requested workload replaces queued targets while a radio ACK is pending', async () => {
  const { manager, stick } = await connected();
  const first = manager.setTargetPower(100);
  await flush();
  const obsolete = manager.setTargetPower(200);
  const latest = manager.setResistance(0);
  stick.event(1, 5); await flush();
  assert.equal(await first, true);
  assert.equal(await obsolete, false);
  const controls = stick.writes.filter(data => data[2] === 0x4f);
  assert.equal(controls.length, 2, 'only in-flight and newest command may reach the radio');
  assert.equal(controls[1][4], 0x30, 'pause release must not sit behind obsolete ERG targets');
  stick.event(1, 5); assert.equal(await latest, true);
});

test('receive gaps do not reject an in-flight resistance command; actual TX completion acknowledges it', async () => {
  const { manager, stick } = await connected();
  let settled = false;
  const command = manager.setResistance(30).then(value => { settled = true; return value; });
  await flush(); stick.event(1, 2); await flush(); // EVENT_RX_FAIL, NOT a transmit failure
  assert.equal(settled, false);
  stick.event(1, 5); assert.equal(await command, true); // TX_COMPLETED
});

test('connect waits for channel-open confirmation instead of resolving on USB assignment', async () => {
  const { manager, stick } = fixture();
  let settled = false;
  const pending = manager.connect(123).then(value => { settled = true; return value; });
  await flush(); assert.equal(settled, false);
  stick.event(0x4b); assert.equal(await pending, true);
});

test('disconnect cancels channel-open wait and late attachment cannot resurrect the connection', async () => {
  const { manager, stick } = fixture();
  let result;
  const pending = manager.connect(123).then(value => { result = value; return value; });
  await flush();
  const obsolete = manager.sensor;
  await manager.disconnect();
  await flush();
  assert.equal(result, false, 'disconnect must settle connect without waiting for its timeout');
  assert.equal(await pending, false);
  obsolete.emit('attached');
  assert.equal(manager.connectionStatus, 'disconnected');
  assert.equal(manager.connectedDeviceId, null);
  stick.event(0x41); await flush(); // channel-unassigned releases the old library reader
  assert.equal(stick.listenerCount('read'), 0);
});
