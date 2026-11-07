/** Keep a trainer command alive and retry failed initial commands instead of caching failure. */
export function startTrainerControl({ send, onError = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
  let active = true;
  let failures = 0;
  let timer;
  const attempt = async () => {
    let failed = false;
    try { failed = await send() === false; } catch { failed = true; }
    if (!active) return;
    failures = failed ? failures + 1 : 0;
    if (!failed || failures === 3) onError(failed ? 'Trainer hasn’t confirmed the workload. Retrying…' : '');
    timer = schedule(attempt, failed ? 2000 : 4000);
  };
  attempt();
  return () => { active = false; cancel(timer); };
}

// ant-plus-next resolves a write when queued; its callback carries the radio ACK.
export function sendAntCommand(send, { schedule = setTimeout, cancel = clearTimeout, timeoutMs = 5000 } = {}) {
  return new Promise(resolve => {
    let settled = false;
    let timer;
    const finish = success => {
      if (settled) return;
      settled = true;
      cancel(timer);
      resolve(success === true);
    };
    timer = schedule(() => finish(false), timeoutMs);
    try {
      Promise.resolve(send(finish)).catch(() => finish(false));
    } catch {
      finish(false);
    }
  });
}
