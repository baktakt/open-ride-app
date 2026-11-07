import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { recoverRideTrainer, initializeTrainerOnce, restoreTrainerSession, ANT_DEVICE_KEY } from '../src/services/trainerSession.js';
import { AntManagerWebUSB } from '../src/services/antManagerWebUSB.js';

const storage = value => ({ getItem: key => key === ANT_DEVICE_KEY ? value : null });

test('startup and dialog initialization share one USB open and never replace a connected stick', async () => {
  const manager = new AntManagerWebUSB();
  let opens = 0; let finish;
  const stick = {};
  manager.openDongle = async () => { opens++; await new Promise(resolve => { finish = resolve; }); manager.stick = stick; manager._dongleStatus = 'connected'; return true; };
  const first = manager.initialize(); const second = manager.initialize();
  await Promise.resolve(); assert.equal(opens, 1); assert.equal(first, second);
  finish(); assert.equal(await first, true);
  manager._connectionStatus = 'connected'; manager.sensor = {};
  await manager.initialize(); assert.equal(opens, 1); assert.equal(manager.stick, stick);
});

test('a failed USB open can be retried, with no permanently stuck initialization', async () => {
  const manager = { dongleStatus: 'disconnected' }; let attempts = 0;
  await assert.rejects(initializeTrainerOnce(manager, async () => { attempts++; throw new Error('Busy'); }), /Busy/);
  assert.equal(await initializeTrainerOnce(manager, async () => { attempts++; return true; }), true);
  assert.equal(attempts, 2);
});

test('StrictMode startup restores the saved ANT trainer once and preserves an existing connection', async () => {
  let opens = 0; let connections = 0;
  const manager = { connectionStatus: 'disconnected', async initialize() { opens++; await Promise.resolve(); return true; }, async connect(id) { connections++; assert.equal(id, 12345); this.connectionStatus = 'connected'; return true; } };
  await Promise.all([restoreTrainerSession(manager, { storage: storage('12345'), deviceKey: ANT_DEVICE_KEY }), restoreTrainerSession(manager, { storage: storage('12345'), deviceKey: ANT_DEVICE_KEY })]);
  assert.equal(opens, 1); assert.equal(connections, 1);
  await restoreTrainerSession(manager, { storage: storage('12345'), deviceKey: ANT_DEVICE_KEY }); assert.equal(opens, 1);
});

test('an explicit disconnect or invalid saved ID never reconnects a trainer', async () => {
  for (const value of [null, '', 'invalid', '-1', '70000']) {
    const manager = { async initialize() { return true; }, connect: assert.fail };
    assert.equal(await restoreTrainerSession(manager, { storage: storage(value), deviceKey: ANT_DEVICE_KEY }), false);
  }
});

function radio() {
  const manager = Object.assign(new EventEmitter(), { connectionStatus: 'disconnected', scanStatus: 'idle', dongleStatus: 'connected' });
  const jobs = new Map();
  const stop = recoverRideTrainer(manager, () => '12345', {
    schedule(fn, delay) { jobs.set(fn, delay); return fn; },
    cancel(fn) { jobs.delete(fn); },
  });
  const next = async () => {
    const [fn, delay] = Array.from(jobs)[0];
    jobs.delete(fn);
    await fn();
    return delay;
  };
  return { manager, jobs, stop, next };
}

test('a dropped channel retries the paired trainer with bounded backoff and resets after real telemetry', async () => {
  const { manager, jobs, stop, next } = radio();
  manager.connect = async (id, recovery) => { assert.equal(id, 12345); assert.equal(recovery, true); return false; };
  manager.emit('radio_lost', 12345);
  manager.emit('radio_lost', 12345);
  assert.equal(jobs.size, 1);
  assert.deepEqual([await next(), await next(), await next()], [2000, 4000, 8000]);
  assert.equal(jobs.size, 0);
  manager.emit('telemetry', {});
  manager.emit('radio_lost', 12345);
  assert.equal(await next(), 2000);
  stop();
  assert.equal(jobs.size, 0);
});

test('manual disconnect, unplugging USB, scanning, or ending the ride cancels radio recovery', async () => {
  const { manager, jobs, stop, next } = radio();
  manager.connect = assert.fail;
  manager.emit('radio_lost', 12345);
  manager.emit('manual_connection');
  assert.equal(jobs.size, 0);
  manager.emit('radio_lost', 12345);
  manager.scanStatus = 'scanning';
  await next();
  manager.scanStatus = 'idle';
  manager.emit('radio_lost', 12345);
  manager.dongleStatus = 'disconnected';
  await next();
  stop();
  manager.emit('radio_lost', 12345);
  assert.equal(jobs.size, 0);
});
