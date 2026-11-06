import { saveRoute } from './routeLibrary.js';

/** Route geometry is usable immediately; optional audio is prepared by the guide separately. */
export async function importPublicRoute(id, { apiBase = '', signal, onProgress = () => {}, fetchImpl = fetch, saveRouteImpl = saveRoute } = {}) {
  onProgress('Loading your curated ride…');
  const response = await fetchImpl(`${apiBase}/api/public-routes/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) throw new Error('This ride is unavailable. Choose another route from the collection.');
  const route = await response.json();
  if (!route.curated || !Array.isArray(route.points) || route.points.length < 2) throw new Error('Invalid curated route.');
  const localRoute = await saveRouteImpl({ ...route, id: `public-${id}`, publicSource: id, curated: true, publication: undefined });
  return { ...localRoute, guideLanguage: route.guide?.language };
}
