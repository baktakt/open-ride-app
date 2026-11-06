import { Router } from 'express';

interface Photo { title: string; imageUrl: string; pageUrl: string; author: string; license: string; licenseUrl: string; lat?: number; lng?: number; }
interface WikiPage { coordinates?: { lat: number; lon: number }[]; pageid?: number; title?: string; pageimage?: string; thumbnail?: { source?: string }; imageinfo?: { descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }[]; }
const plain = (value: string): string => value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim().slice(0, 300);
const safeUrl = (value: string | undefined, host: string): string => {
  try { const url = new URL(value || ''); return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password ? url.href : ''; } catch { return ''; }
};

/** Free, attributed illustrations of the exact guide topic; never unrelated nearby businesses. */
export function createGuidePhotosRouter({ fetchImpl = fetch, now = Date.now } = {}) {
  const router = Router();
  const cache = new Map<string, { expires: number; photo: Photo | null }>();
  const pending = new Map<string, Promise<Photo | null>>();
  let window = now(); let requests = 0;
  const query = async (host: string, parameters: Record<string, string>): Promise<WikiPage[]> => {
    const url = new URL(`https://${host}/w/api.php`);
    url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...parameters }).toString();
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'OpenRide/0.1 (https://github.com/baktakt/open-ride-app)', Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json() as { query?: { pages?: WikiPage[] }; error?: unknown };
    if (data.error) throw new Error('Invalid response');
    return data.query?.pages || [];
  };
  router.get('/', async (req, res) => {
    const language = req.query.language || 'en';
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    const pageId = typeof req.query.pageId === 'string' ? req.query.pageId : '';
    if (!['en', 'sv'].includes(String(language)) || (!title && !pageId) || title.length > 180 || title.includes('|') || (pageId && !/^\d{1,12}$/.test(pageId))) { res.status(400).json({ error: 'A valid guide topic is required.' }); return; }
    if (now() - window >= 60000) { requests = 0; window = now(); }
    if (++requests > 120) { res.status(429).json({ error: 'Guide photos will retry shortly.' }); return; }
    const key = `${language}/${pageId || title}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now()) { res.json({ photo: hit.photo }); return; }
    try {
      let task = pending.get(key);
      if (!task) {
        task = (async () => {
          const page = (await query(`${language}.wikipedia.org`, { ...(pageId ? { pageids: pageId } : { titles: title }), redirects: '1', prop: 'pageimages|coordinates', piprop: 'name|thumbnail', pilicense: 'free', pithumbsize: '800' }))[0];
          const imageUrl = safeUrl(page?.thumbnail?.source, 'upload.wikimedia.org') || safeUrl(page?.thumbnail?.source, 'thumb.wikimedia.org');
          if (!imageUrl || !page?.pageimage || !page.pageid) return null;
          const file = (await query('commons.wikimedia.org', { titles: `File:${page.pageimage}`, prop: 'imageinfo', iiprop: 'extmetadata|url' }))[0]?.imageinfo?.[0];
          const metadata = file?.extmetadata || {};
          const pageUrl = safeUrl(file?.descriptionurl, 'commons.wikimedia.org');
          const license = plain(metadata.LicenseShortName?.value || '');
          if (!pageUrl || !license) return null;
          const coord = page.coordinates?.[0];
          const location = coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lon) && Math.abs(coord.lat) <= 90 && Math.abs(coord.lon) <= 180 ? { lat: coord.lat, lng: coord.lon } : {};
          return { ...location, title: page.title || title, imageUrl, pageUrl, author: plain(metadata.Artist?.value || metadata.Credit?.value || 'Wikimedia Commons contributor'), license,
            licenseUrl: safeUrl(metadata.LicenseUrl?.value?.replace(/^http:/, 'https:'), 'creativecommons.org') || pageUrl };
        })().then(photo => {
          for (const [id, entry] of cache) if (entry.expires <= now()) cache.delete(id);
          if (cache.size >= 256) cache.delete(cache.keys().next().value!);
          cache.set(key, { expires: now() + 86400000, photo }); return photo;
        }).finally(() => pending.delete(key));
        pending.set(key, task);
      }
      res.json({ photo: await task });
    } catch { res.status(502).json({ error: 'Guide photos are temporarily unavailable.' }); }
  });
  return router;
}
