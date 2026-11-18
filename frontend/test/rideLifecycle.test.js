import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'vite';

// Dependency-free browser regression: uses installed Chrome + Node's WebSocket.
// CHROME_BIN can point at another Chromium executable. No hardware/backend needed.
const chrome = process.env.CHROME_BIN || ['google-chrome', 'chromium', 'chromium-browser']
  .find(bin => spawnSync('which', [bin]).status === 0);

test('route ride lifecycle in real React and Chromium', { skip: !chrome && 'Install Chromium or set CHROME_BIN', timeout: 90000 }, async t => {
  assert.equal(typeof WebSocket, 'function', 'Browser tests require Node 22+ (built-in WebSocket)');
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { port: 0, host: '127.0.0.1', open: false },
    plugins: [{
      name: 'expose-app-shell-for-lifecycle-test',
      transform(code, id) {
        if (id.endsWith('/src/App.jsx')) return `${code}\nexport { AppShell };`;
      },
    }],
  });
  await server.listen();
  t.after(() => server.close());
  const profile = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'openride-lifecycle-'));
  const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  t.after(async () => {
    const exited = new Promise(resolve => browser.once('exit', resolve));
    if (browser.exitCode === null) { browser.kill(); await exited; }
    await rm(profile, { recursive: true, force: true });
  });
  let port;
  for (let i = 0; i < 200; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch {}
    await sleep(25);
  }
  assert.ok(port, 'Chrome did not start its debugging endpoint');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  t.after(() => socket.close());
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.id) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    }
  };
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: `${server.resolvedUrls.local[0]}test/fixtures/rideLifecycle.html` });
  let ready = false;
  for (let i = 0; i < 300; i++) {
    if (await evaluate('Boolean(window.lifecycleReady)')) { ready = true; break; }
    await sleep(50);
  }
  assert.ok(ready, `Lifecycle fixture did not load: ${JSON.stringify(errors)}`);
  for (const scenario of ['stop and save', 'automatic completion', 'short ride discard', 'ride again', 'navigate while riding']) {
    await t.test(scenario, async () => {
      const result = await evaluate(`window.runLifecycleScenario(${JSON.stringify(scenario)}).then(() => ({ ok: true }), error => ({ ok: false, message: error.message, stack: error.stack }))`);
      assert.equal(result.ok, true, `${scenario}: ${result.message}\n${result.stack || ''}`);
    });
  }
  assert.deepEqual(errors, [], 'Uncaught browser errors');
});
