import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTrainerControl, sendAntCommand } from '../src/services/trainerControl.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('a rejected first power command retries automatically and successful targets keep alive', async () => {
  let attempts = 0; const jobs = []; const notices = [];
  const stop = startTrainerControl({ send: async () => ++attempts > 1, onError: value => notices.push(value), schedule: (fn, delay) => { jobs.push({ fn, delay }); return 1; }, cancel() {} });
  await flush(); assert.equal(jobs[0].delay, 2000); assert.ok(notices[0]);
  jobs.shift().fn(); await flush(); assert.equal(attempts, 2); assert.equal(notices[1], ''); assert.equal(jobs[0].delay, 4000);
  stop();
});

test('a pending command cannot schedule further writes after pause or navigation ends its controller', async () => {
  let complete; let scheduled = 0;
  const stop = startTrainerControl({ send: () => new Promise(resolve => { complete = resolve; }), schedule: () => scheduled++, cancel() {} });
  stop(); complete(true); await flush(); assert.equal(scheduled, 0);
});

test('ANT writes wait for the radio acknowledgement rather than queue acceptance', async () => {
  let ack; let settled = false;
  const pending = sendAntCommand(callback => { ack = callback; return Promise.resolve(); }).then(value => { settled = true; return value; });
  await flush(); assert.equal(settled, false);
  ack(false); assert.equal(await pending, false);
  assert.equal(await sendAntCommand(callback => callback(true)), true);
});

test('missing ANT acknowledgements and USB write failures report a failed command', async () => {
  let expire; let cancelled = 0;
  const pending = sendAntCommand(() => Promise.resolve(), { schedule: fn => { expire = fn; return 1; }, cancel: () => cancelled++ });
  expire(); assert.equal(await pending, false); assert.equal(cancelled, 1);
  assert.equal(await sendAntCommand(() => Promise.reject(new Error('USB unavailable'))), false);
});
