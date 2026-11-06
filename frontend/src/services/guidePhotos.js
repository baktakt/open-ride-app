// Exact article topics for the editorial starter scripts. Existing saved copies
// also resolve correctly without overwriting a rider's edited guide.
const topics = {
  'Whitechapel: five lives, not a legend': 'Whitechapel',
  'Spitalfields and the lives behind the headlines': 'Christ Church, Spitalfields',
  'Durward Street and historical uncertainty': 'Whitechapel',
  'Mitre Square: remembering Catherine Eddowes': 'Mitre Square',
  'Greystone: a house with a screen career': 'Greystone Mansion',
  'Schindler House: living as an experiment': 'Schindler House',
  'A movie palace on Hollywood Boulevard': "Grauman's Chinese Theatre",
  'Hollyhock House and a new Los Angeles': 'Hollyhock House',
  'Griffith Observatory: the stars above Hollywood': 'Griffith Observatory',
  'The Colosseum and the scale of empire': 'Colosseum',
  'Circus Maximus: a city gathered for racing': 'Circus Maximus',
  'The Baths of Caracalla': 'Baths of Caracalla',
  'The Appian Way and Cecilia Metella': 'Tomb of Caecilia Metella',
  'The Villa of the Quintilii': 'Villa of the Quintilii',
  'Bastille: a fortress remembered in a square': 'Place de la Bastille',
  'The Conciergerie: a building changes roles': 'Conciergerie',
  'Concorde: a name chosen after upheaval': 'Place de la Concorde',
  'The Arc de Triomphe and the memory of power': 'Arc de Triomphe',
  'The Panthéon: who does a nation remember?': 'Panthéon',
  'Bourg-d’Oisans: settle into the climb': "Le Bourg-d'Oisans",
  'La Garde: the road as a grandstand': 'La Garde, Isère',
  'Huez: a village beneath the sporting legend': 'Huez',
  'The final approach: your own version of the Alpe': "Alpe d'Huez",
};

export function guidePhotoQuery(landmark) {
  for (const source of landmark.sources || [{ url: landmark.url }]) {
    try {
      const url = new URL(source.url);
      if (!/^(en|sv)\.wikipedia\.org$/.test(url.hostname)) continue;
      const language = url.hostname.slice(0, 2);
      if (/^\d+$/.test(url.searchParams.get('curid') || '')) return { pageId: url.searchParams.get('curid'), language };
      if (url.pathname.startsWith('/wiki/')) {
        const title = decodeURIComponent(url.pathname.slice(6)).replaceAll('_', ' ');
        if (title && !title.includes(':') && !title.includes('|')) return { title, language };
      }
    } catch { /* No exact article reference available. */ }
  }
  const title = landmark.photoTitle || topics[landmark.title];
  return title ? { title, language: 'en' } : null;
}

export function guidePhotoStops(stops, distanceKm, activeId) {
  let index = stops.findIndex(stop => stop.id === activeId);
  if (index < 0) index = stops.findLastIndex(stop => stop.status === 'heard');
  if (index < 0) index = distanceKm < 0.5 ? 0 : stops.findIndex(stop => stop.distanceKm >= distanceKm - 0.1);
  if (index < 0) index = Math.max(0, stops.length - 1);
  return stops.slice(index, index + 4);
}
