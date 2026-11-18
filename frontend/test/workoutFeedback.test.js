import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'vite';

const chrome = process.env.CHROME_BIN || ['google-chrome', 'chromium', 'chromium-browser'].find(bin => spawnSync('which', [bin]).status === 0);
test('workout feedback survives fault/recovery without moving ride controls (real Chromium)', { skip: !chrome, timeout: 30000 }, async t => {
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { port: 0, host: '127.0.0.1', open: false } });
  await server.listen(); t.after(() => server.close());
  const profile = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'openride-feedback-'));
  const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  t.after(async () => {
    if (browser.exitCode === null) { const exited = new Promise(resolve => browser.once('exit', resolve)); browser.kill(); await exited; }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  let port;
  for (let i = 0; i < 200; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch {}
    await sleep(25);
  }
  assert.ok(port, 'Chrome debugging endpoint');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  t.after(() => socket.close());
  let sequence = 0; const pending = new Map(); const errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.id) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); }
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: `${server.resolvedUrls.local[0]}test/fixtures/workoutFeedback.html` });
  let ready;
  for (let i = 0; i < 300; i++) { ready = await evaluate('Boolean(window.feedbackReady)'); if (ready) break; await sleep(25); }
  assert.ok(ready, JSON.stringify(errors));
  for (const width of [1280, 390]) {
    if (width === 390) {
      await evaluate('window.feedbackReady = false');
      await cdp('Page.reload');
      for (let i = 0; i < 300; i++) { if (await evaluate('Boolean(window.feedbackReady)')) break; await sleep(25); }
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const result = await evaluate('window.runFeedback().catch(error => ({ ok: false, message: error.message }))');
    assert.equal(result.ok, true, `${width}px: ${JSON.stringify(result)}`);
    t.diagnostic(`${width}px: workout top ${result.before} -> ${result.after}`);
  }
  assert.deepEqual(errors, [], 'Uncaught browser errors');
});
