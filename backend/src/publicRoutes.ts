import { Router } from 'express';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
interface GuideStop { id: string; title: string; text: string; distanceKm: number; lat: number; lng: number; audioSeconds?: number; photoTitle?: string; sources: { title: string; url: string }[]; }
interface PreparedGuide { version: number; id: string; routeHash: string; routeName: string; language: string; stops: GuideStop[]; }

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
interface Point { lat: number; lng: number; ele: number; distanceFromStart: number; }
export interface PublicRoute { version: number; id: string; name: string; description: string; points: Point[]; routeHash: string; estimatedMinutes: number; totalDistance: number; elevationGain: number; minEle: number; maxEle: number; publishedAt: string; guide: PreparedGuide | null; curated?: boolean; theme?: string; contentNote?: string; attribution?: string; paceNote?: string; sources?: { title: string; url: string }[]; }
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export function validatePublicRoute(value: unknown, id: string): PublicRoute | null {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 150 || typeof data.description !== 'string' || data.description.length > 1000 || !Array.isArray(data.points) || data.points.length < 2 || data.points.length > 20000 || typeof data.estimatedMinutes !== 'number' || data.estimatedMinutes < 1 || data.estimatedMinutes > 1440) return null;
  const points: Point[] = [];
  let previous = 0;
  let gain = 0;
  for (const raw of data.points) {
    if (!raw || !['lat', 'lng', 'ele', 'distanceFromStart'].every(key => typeof raw[key] === 'number' && Number.isFinite(raw[key])) || Math.abs(raw.lat) > 90 || Math.abs(raw.lng) > 180 || raw.ele < -500 || raw.ele > 9000 || raw.distanceFromStart < previous || raw.distanceFromStart > 2000 || (!points.length && raw.distanceFromStart !== 0)) return null;
    if (points.length) {
      const last = points.at(-1)!;
      const rad = Math.PI / 180;
      const a = Math.sin((raw.lat - last.lat) * rad / 2) ** 2 + Math.cos(last.lat * rad) * Math.cos(raw.lat * rad) * Math.sin((raw.lng - last.lng) * rad / 2) ** 2;
      const km = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
      if (Math.abs(raw.distanceFromStart - previous - km) > 0.05) return null;
      gain += Math.max(0, raw.ele - last.ele);
    }
    points.push({ lat: raw.lat, lng: raw.lng, ele: raw.ele, distanceFromStart: raw.distanceFromStart }); previous = raw.distanceFromStart;
  }
  if (previous < 0.1) return null;
  const routeHash = hash(JSON.stringify(points.map(point => [point.lat, point.lng, point.ele, point.distanceFromStart])));
  return { version: 1, id, name: data.name.trim(), description: data.description.trim(), points, routeHash, estimatedMinutes: Math.round(data.estimatedMinutes), totalDistance: previous, elevationGain: Math.round(gain), minEle: Math.min(...points.map(point => point.ele)), maxEle: Math.max(...points.map(point => point.ele)), publishedAt: new Date().toISOString(), guide: null, attribution: typeof data.attribution === 'string' ? data.attribution.slice(0, 500) : 'Shared by the Open Ride community', contentNote: typeof data.contentNote === 'string' ? data.contentNote.slice(0, 300) : undefined };
}
function previewPath(route: PublicRoute): string {
  const sample = route.points.filter((_point, index) => index % Math.max(1, Math.ceil(route.points.length / 180)) === 0 || index === route.points.length - 1);
  const latitude = sample[0].lat * Math.PI / 180;
  const xs = sample.map(point => point.lng * Math.cos(latitude)); const ys = sample.map(point => point.lat);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const scale = Math.min(350 / Math.max(.00001, maxX - minX), 88 / Math.max(.00001, maxY - minY));
  const left = (400 - (maxX - minX) * scale) / 2; const top = (110 - (maxY - minY) * scale) / 2;
  return sample.map((_point, index) => `${index ? 'L' : 'M'}${(left + (xs[index] - minX) * scale).toFixed(1)},${(top + (maxY - ys[index]) * scale).toFixed(1)}`).join(' ');
}
const summary = (route: PublicRoute) => ({ id: route.id, name: route.name, description: route.description, totalDistance: route.totalDistance, elevationGain: route.elevationGain, estimatedMinutes: route.estimatedMinutes, publishedAt: route.publishedAt, hasGuide: Boolean(route.guide), storyCount: route.guide?.stops.length || 0, narrationSeconds: route.guide?.stops.reduce((total, stop) => total + (stop.audioSeconds || 0), 0) || 0, curated: Boolean(route.curated), theme: route.theme, contentNote: route.contentNote, paceNote: route.paceNote, previewPath: previewPath(route) });

export async function loadStarterRoutes(): Promise<PublicRoute[]> {
  const file = fileURLToPath(new URL('../routes/starter-routes.json', import.meta.url));
  try { return JSON.parse(await readFile(file, 'utf8')) as PublicRoute[]; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

/** The public collection is curated in the repository. Personal routes have no upload API. */
export function createPublicRoutesRouter({ starters = loadStarterRoutes } = {}) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/', async (_req, res) => {
    try { res.json({ routes: (await starters()).map(summary) }); }
    catch { res.status(502).json({ error: 'The route collection is temporarily unavailable.' }); }
  });
  router.get('/:id', async (req, res) => {
    if (!uuid.test(String(req.params.id))) { res.status(400).json({ error: 'Invalid route.' }); return; }
    try {
      const route = (await starters()).find(item => item.id === req.params.id);
      if (!route) { res.status(404).json({ error: 'This route is not in the collection.' }); return; }
      res.json(route);
    } catch { res.status(502).json({ error: 'Could not load this route.' }); }
  });
  router.get('/:id/audio/:clipId', async (req, res) => {
    if (!uuid.test(String(req.params.id)) || !uuid.test(String(req.params.clipId))) { res.status(400).json({ error: 'Invalid audio.' }); return; }
    try {
      const route = (await starters()).find(item => item.id === req.params.id);
      if (!route?.guide?.stops.some(stop => stop.id === req.params.clipId)) { res.status(404).json({ error: 'This story is unavailable.' }); return; }
      const data = await readFile(fileURLToPath(new URL(`../routes/audio/${req.params.id}/${req.params.clipId}.wav`, import.meta.url)));
      res.type('audio/wav').send(data);
    } catch { res.status(502).json({ error: 'Story audio is unavailable. You can still ride with captions.' }); }
  });
  router.use((_req, res) => { res.status(405).json({ error: 'This collection is read-only. GPX routes stay on your device.' }); });
  return router;
}
