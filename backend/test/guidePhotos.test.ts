import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createGuidePhotosRouter } from '../src/guidePhotos.js';

test('guide photos use exact topic queries, retain credits, cache and reject unsafe requests', async () => {
  let calls = 0;
  const app = express();
  app.use('/photos', createGuidePhotosRouter({ fetchImpl: async input => {
    calls++;
    const url = new URL(String(input));
    if (url.hostname === 'en.wikipedia.org') {
      assert.equal(url.searchParams.get('titles'), 'Greystone Mansion');
      assert.equal(url.searchParams.get('pilicense'), 'free');
      assert.equal(url.searchParams.has('generator'), false);
      return Response.json({ query: { pages: [{ pageid: 10, title: 'Greystone Mansion', pageimage: 'Greystone.jpg', thumbnail: { source: 'https://thumb.wikimedia.org/wikipedia/commons/a/aa/Greystone.jpg' }, coordinates: [{ lat: 34.09, lon: -118.4 }] }] } });
    }
    assert.equal(url.hostname, 'commons.wikimedia.org');
    return Response.json({ query: { pages: [{ imageinfo: [{ descriptionurl: 'https://commons.wikimedia.org/wiki/File:Greystone.jpg', extmetadata: { Artist: { value: '<a href="/user">A Photographer</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' } } }] }] } });
  } }));
  const server = createServer(app); server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/photos`;
  try {
    const result = await (await fetch(`${base}?title=Greystone%20Mansion`)).json();
    assert.equal(result.photo.title, 'Greystone Mansion');
    assert.equal(result.photo.author, 'A Photographer');
    assert.equal(result.photo.license, 'CC BY-SA 4.0');
    assert.equal(result.photo.lat, 34.09);
    await fetch(`${base}?title=Greystone%20Mansion`);
    assert.equal(calls, 2);
    assert.equal((await fetch(`${base}?title=A%7CB`)).status, 400);
    assert.equal((await fetch(`${base}?title=Greystone&language=evil.example`)).status, 400);
    assert.equal((await fetch(`${base}?pageId=https://evil.example`)).status, 400);
    assert.equal(calls, 2);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
