/** Share a sign for stories planned at the same spot instead of stacking icons. */
export function groupGuideStops(stops) {
  const groups = [];
  for (const stop of stops) {
    const group = groups.find(item => Math.abs(item.distanceKm - stop.distanceKm) < 0.05);
    if (group) group.members.push(stop);
    else groups.push({ ...stop, members: [stop] });
  }
  return groups.map(group => ({ ...group,
    status: group.members.some(item => item.status === 'active') ? 'active' : group.members.some(item => item.status === 'upcoming') ? 'upcoming' : 'heard',
    label: group.members.map(item => item.landmark.title).join(' · '),
    landmark: { ...group.landmark, title: `${group.landmark.title}${group.members.length > 1 ? ` + ${group.members.length - 1} stories` : ''}` },
  }));
}
