import { Router } from 'express';
import { randomUUID } from 'node:crypto';

interface PhotoAuthor { displayName?: string; uri?: string; }
interface Place {
  displayName?: { text?: string };
  location?: { latitude: number; longitude: number };
  googleMapsUri?: string;
  photos?: { name: string; authorAttributions?: PhotoAuthor[] }[];
}

export function distanceMeters(lat: number, lng: number, otherLat: number, otherLng: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin((otherLat - lat) * rad / 2) ** 2 + Math.cos(lat * rad) * Math.cos(otherLat * rad) * Math.sin((otherLng - lng) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** Google Places content is short-lived and never written to disk. The key stays on the server. */
export function createNearbyPhotosRouter({ apiKey = process.env.GOOGLE_PLACES_API_KEY, fetchImpl = fetch } = {}) {
  const router = Router();
  const photos = new Map<string, { name: string; expires: number }>();
  let windowStart = Date.now();
  let requests = 0;
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!apiKey) { res.status(503).json({ error: 'Nearby photos are unavailable: Google Places is not configured.' }); return; }
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requests = 0; }
    if (++requests > 60) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'Photo request limit reached. Try again shortly.' }); return; }
    next();
  });

  router.get('/', async (req, res) => {
    const lat = typeof req.query.lat === 'string' && req.query.lat.trim() ? Number(req.query.lat) : NaN;
    const lng = typeof req.query.lng === 'string' && req.query.lng.trim() ? Number(req.query.lng) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      res.status(400).json({ error: 'Valid latitude and longitude are required.' }); return;
    }
    try {
      const response = await fetchImpl('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey!, 'X-Goog-FieldMask': 'places.displayName,places.location,places.googleMapsUri,places.photos' },
        body: JSON.stringify({ maxResultCount: 8, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 1500 } } }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Places request failed');
      const data = await response.json() as { places?: Place[] };
      for (const [token, photo] of photos) if (photo.expires <= Date.now()) photos.delete(token);
      const places = (data.places || []).filter(place => place.location && place.photos?.length).slice(0, 4).map(place => {
        const photo = place.photos![0];
        const token = randomUUID();
        if (photos.size >= 128) photos.delete(photos.keys().next().value!);
        photos.set(token, { name: photo.name, expires: Date.now() + 5 * 60000 });
        return {
          name: place.displayName?.text || 'Nearby place',
          location: place.location,
          distanceM: Math.round(distanceMeters(lat, lng, place.location!.latitude, place.location!.longitude)),
          mapsUri: place.googleMapsUri,
          photoUrl: `/api/nearby-photos/${token}`,
          authors: photo.authorAttributions || [],
        };
      });
      res.json({ places });
    } catch {
      res.status(502).json({ error: 'Google Places photos could not be loaded. Try again shortly.' });
    }
  });

  router.get('/:token', async (req, res) => {
    const photo = photos.get(String(req.params.token));
    if (!photo || photo.expires <= Date.now()) { res.status(404).end(); return; }
    try {
      const url = new URL(`https://places.googleapis.com/v1/${photo.name}/media`);
      url.searchParams.set('maxWidthPx', '800');
      url.searchParams.set('skipHttpRedirect', 'true');
      const response = await fetchImpl(url, { headers: { 'X-Goog-Api-Key': apiKey! }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Photo request failed');
      const data = await response.json() as { photoUri?: string };
      const imageUrl = new URL(data.photoUri || '');
      if (imageUrl.protocol !== 'https:' || !(imageUrl.hostname.endsWith('.googleusercontent.com') || imageUrl.hostname.endsWith('.gstatic.com'))) throw new Error('Invalid photo URL');
      res.redirect(imageUrl.href);
    } catch { res.status(502).end(); }
  });
  return router;
}
