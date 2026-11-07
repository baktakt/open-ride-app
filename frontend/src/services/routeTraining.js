// A distance-based workout completes its warm-up and cooldown on every route,
// regardless of terrain, speed or story timing. Targets are fractions of rider FTP.
const blocks = [
  { end: .10, name: 'Warm-up', from: .50, to: .65 },
  { end: .25, name: 'Endurance', from: .70, to: .70 },
  { end: .32, name: 'Tempo', from: .80, to: .80 },
  { end: .40, name: 'Recovery', from: .60, to: .60 },
  { end: .55, name: 'Endurance', from: .72, to: .72 },
  { end: .62, name: 'Tempo', from: .85, to: .85 },
  { end: .70, name: 'Recovery', from: .60, to: .60 },
  { end: .83, name: 'Endurance', from: .75, to: .75 },
  { end: .90, name: 'Tempo', from: .80, to: .80 },
  { end: 1, name: 'Cool-down', from: .65, to: .45 },
];

export function routeTrainingTarget(distanceKm, totalKm, ftp) {
  const progress = Math.max(0, Math.min(1, totalKm > 0 ? distanceKm / totalKm : 0));
  const index = Math.max(0, blocks.findIndex(block => progress < block.end || block.end === 1));
  const block = blocks[index];
  const start = blocks[index - 1]?.end || 0;
  const portion = Math.max(0, Math.min(1, (progress - start) / (block.end - start)));
  const fraction = block.from + (block.to - block.from) * portion;
  const riderFtp = Number.isFinite(Number(ftp)) && Number(ftp) > 0 ? Math.min(600, Math.max(50, Number(ftp))) : 200;
  return { name: block.name, watts: Math.round(riderFtp * fraction), percent: Math.round(fraction * 100), progress };
}

export function routeTrainingProfile() {
  let start = 0;
  return blocks.map(block => {
    const result = { ...block, start };
    start = block.end;
    return result;
  });
}
