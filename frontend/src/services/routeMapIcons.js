/** Self-contained SVG pins: Leaflet positions the tip, CSS never changes the geometry. */
export function placeMarkerSvg(type, count = 1) {
  const glyph = type === 'guide'
    ? '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>'
    : '<path d="M9 5h6l2 3h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3Z"/><circle cx="12" cy="14" r="4"/>';
  const badge = Number.isFinite(count) && count > 1
    ? `<circle cx="28" cy="7" r="7" fill="#fff"/><text x="28" y="10" text-anchor="middle" fill="#133b54" font-family="sans-serif" font-size="9" font-weight="700">${Math.min(99, Math.floor(count))}</text>` : '';
  return `<svg class="route-place-pin" xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44" aria-hidden="true"><path class="route-place-pin-body" d="M18 42C15 38 3 28 3 17a15 15 0 0 1 30 0c0 11-12 21-15 25Z" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><g transform="translate(6 5)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>${badge}</svg>`;
}

/** Group only markers whose icons would overlap at the current zoom. */
export function groupPhotoMarkers(places, project, separation = 36) {
  const groups = [];
  for (const place of places) {
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const point = project(lat, lng);
    const group = groups.find(item => Math.hypot(item.point.x - point.x, item.point.y - point.y) < separation);
    if (group) group.places.push(place);
    else groups.push({ lat, lng, point, places: [place] });
  }
  return groups;
}
