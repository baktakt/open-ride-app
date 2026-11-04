/** Predict between distance samples without pulling the rider back each frame. */
export function createRouteMotion(distanceM = 0) {
  let shown = distanceM;
  let reported = distanceM;
  let receivedAt = null;
  return (distance, speedKmh, riding, now, dt) => {
    const speed = Math.max(0, Number(speedKmh) || 0) / 3.6;
    if (receivedAt === null || distance !== reported) {
      if (distance < reported) shown = distance;
      reported = distance;
      receivedAt = now;
    }
    if (!riding) {
      shown = distance;
      receivedAt = now;
      return shown;
    }
    const target = reported + speed * Math.min(1.25, Math.max(0, (now - receivedAt) / 1000));
    const correction = (target - shown) * 2;
    shown += Math.max(0, speed + correction) * Math.min(0.1, Math.max(0, dt));
    return shown;
  };
}
