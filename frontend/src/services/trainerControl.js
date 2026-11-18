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
export function sendAntCommand(send, { schedule = setTimeout, cancel = clearTimeout, timeoutMs = 5000, onUncertain = () => {}, signal } = {}) {
  return new Promise(resolve => {
    let settled = false;
    let timer;
    const finish = success => {
      if (settled) return;
      settled = true;
      cancel(timer);
      signal?.removeEventListener('abort', aborted);
      resolve(success === true);
    };
    const aborted = () => finish(false);
    const uncertain = () => {
      if (settled) return;
      onUncertain();
      finish(false);
    };
    timer = schedule(uncertain, timeoutMs);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    try {
      Promise.resolve(send(finish)).catch(uncertain);
    } catch {
      uncertain();
    }
  });
}
