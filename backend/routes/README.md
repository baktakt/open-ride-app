# Open Ride starter routes

These are indoor cycling experiences, not outdoor navigation instructions or certified race courses. Estimated times use the pace stated on each route. Power, rider weight and trainer settings change the actual ride time.

| Route | Distance | Approx. time | Assumed speed |
|---|---:|---:|---:|
| Whitechapel 1888: Beyond the Ripper Legend | 12.3 km | 31 min | 24 km/h |
| Hollywood: Stars, Studios & Historic Homes | 19.9 km | 85 min | 14 km/h |
| Rome: Empire, Baths & the Appian Way | 21.8 km | 73 min | 18 km/h |
| Paris: Revolution & the River | 15.9 km | 53 min | 18 km/h |
| Alpe d’Huez: The 21-Bend Challenge | 15.6 km | 104 min | 9 km/h |

## Geometry and elevation

Road geometry is derived from [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under the [ODbL](https://opendatacommons.org/licenses/odbl/1-0/), and routed using the [FOSSGIS OSRM service](https://routing.openstreetmap.de/). The checked-in JSON makes the derived route data available. The road-routing service is used only by the explicit maintenance script, never during normal playback. The Alpe route uses the road/car profile to retain the D211 hairpins; the other routes use the bike profile. These tracks can include paths, access restrictions or routing artefacts and must not be treated as on-road advice.

Elevation is sampled from [Mapzen/AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), using Terrarium tiles at zoom 12 and a short moving average. It is approximate terrain elevation, not a survey of the road surface. Alpe d’Huez includes the village approach and a resort finish; its distance and ascent differ from the official timed climb.

## Narration and sources

The scripts are short, editorially curated, AI-assisted summaries, not verbatim source recordings. There are 48 chapters across the five rides, with opening and closing stories and quiet stretches between them. Source links are retained on each stop. The Whitechapel guide is non-graphic and focuses on victims, the East End and uncertainty rather than unproven claims about the killer. The Hollywood guide uses historic sites, house museums and public landmarks, not current private celebrity residences.

Primary references include:

- [London Museum: Jack the Ripper](https://www.londonmuseum.org.uk/collections/london-stories/jack-ripper/)
- [MAK Center: Schindler House](https://www.makcenter.org/about)
- [Frank Lloyd Wright Foundation: Hollyhock House](https://franklloydwright.org/site/hollyhock-house/)
- [Friends of Greystone: history](https://greystonemansion.org/history-2/)
- [LA Conservancy: Chinese Theatre](https://www.laconservancy.org/learn/historic-places/chinese-theatre/)
- [Griffith Observatory: history](https://griffithobservatory.lacity.gov/about/observatory-history/)
- [Turismo Roma: Appian Way](https://www.turismoroma.it/en/itineraries/la-appia-antica)
- [Turismo Roma: Caracalla to the Colosseum](https://www.turismoroma.it/en/node/6134)
- [City of Paris: Bastille history](https://www.paris.fr/pages/petites-et-grandes-histoires-de-la-bastille-15995)
- [City of Paris: Concorde and the Revolution](https://parcoursrevolution.paris.fr/fr/quartiers/12-le-quartier-de-la-place-de-la-concorde)
- [Alpe d’Huez tourism: the 21 bends](https://www.alpedhuez.com/en/activities/summer-activities/bike/the-21-bends/)

Audio is AI-generated locally using [Kokoro-82M v1.0](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), quantized q8, voice `af_heart`. No user's API key or paid speech service is used to create the starter recordings. WAV assets are included so listening requires neither an API key nor a model download. `.sha256` files track each recording's source text for incremental regeneration.

## Maintenance

1. `python3 scripts/build-starter-routes.py` from the repository root (requires Pillow; it downloads public routing/terrain data into an ignored cache).
2. `python3 scripts/curate-starter-stories.py` applies the reviewed chapters to that geometry.
3. `node scripts/render-starter-guides.mjs` (uses the installed frontend Kokoro dependencies and downloads the model once).
4. Run backend tests, which validate tracks, fingerprints, durations, sources and recording completeness.

Changing route geometry invalidates its route fingerprint. Script text changes invalidate the matching WAV via its checksum. Re-run rendering after rebuilding the route manifest to calculate the JavaScript-compatible fingerprints. Check all historical claims and routes before publishing a revised collection. Keep these assets included in backend deployments; `backend/vercel.json` explicitly includes them.
