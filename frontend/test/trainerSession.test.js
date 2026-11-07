import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTrainerOnce, restoreTrainerSession, ANT_DEVICE_KEY } from '../src/services/trainerSession.js';
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
