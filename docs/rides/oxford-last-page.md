# Oxford: The Names at the End of the Quest

> Ride through Tolkien's Oxford to a quiet grave, and discover why the creator of Middle-earth put two fictional lovers' names on a real stone.

## Editorial contract

A real literary-history quest, not an impersonation of Tolkien or a new Middle-earth story. The mystery in the opening chooses the finish: Wolvercote Cemetery. Exeter supplies the beginning; east Oxford and the Marston cycle corridor create breathing room, Northmoor Road brings us past the working writer's neighbourhood, and the return toward the Inklings' city centre precedes the final northern approach. The road never pretends to visit Yorkshire, the Somme, or a fictional location.

About 40 minutes at 25 km/h: 16.526 km, 62 m modelled ascent. Eleven distance-triggered chapters, normally 3.96 minutes apart; the last gap is 3.12 minutes. At a different riding speed the timing changes. This is not a fixed forty-minute workout. Automatic endurance mode supplies the existing hands-free trainer workload. No mid-ride interactions, visual puzzles, sprints or required changes of posture.

Grief and wartime loss are discussed non-graphically. The destination is an affectionate remembrance, not a macabre twist. Motivation comes from answering the opening question in steps, not shaming the rider or calling suffering character-building.

## Beat sheet (before speech generation)

All chapter facts below were checked against [The Tolkien Society biography, archived 23 May 2024](https://web.archive.org/web/20240523115311/https://www.tolkiensociety.org/author/biography/). The live page returned HTTP 403 during authoring. An archived source is identified as such, not presented as a live retrieval. The chapter text is original paraphrase. No invented historical dialogue or extracts from Tolkien's fiction.

| km | Reference minute | What is actually nearby / relationship to story | Question answered → next pull | Evidence |
|---:|---:|---|---|---|
| 0 | 0.00 | Public street beside Exeter College; not inside its grounds | Why ride? Two unfamiliar names wait on a real grave → where did the world-builder begin? | Biography: Exeter studies; final burial and inscription |
| 1.65 | 3.96 | East Oxford, beyond Magdalen Bridge; Exeter is explicitly behind us | A disappointing classics result led to English → who speaks an invented language? | Childhood and Youth: change of course, linguistic interests |
| 3.30 | 7.92 | Marston Road corridor; wartime episode explicitly leaves Oxford | A world began amid actual loss, not uncomplicated escapism → how does a hobbit enter it? | War, Lost Tales and Academia: marriage, Somme, illness and friends' deaths |
| 4.95 | 11.88 | Riding north through Marston; examination anecdote is contextual | A blank answer-book page became the beginning of The Hobbit → who gets it finished? | The Storyteller: explicitly Tolkien's own account, not independently documented scene |
| 6.60 | 15.84 | Marston cycle corridor heading toward north Oxford | Dagnall encouraged completion; ten-year-old Rayner approved → what happens to the sequel? | The Storyteller: Dagnall, Unwin and 1937 publication |
| 8.25 | 19.80 | North Oxford; Northmoor Road is still ahead on this pass | A request for more hobbits expanded into a sixteen-year publication journey → who listens? | The Storyteller: sequel and publication; Northmoor is a route location, not a claim the road proves composition |
| 9.90 | 23.76 | Southbound toward the centre; Eagle and Child still ahead | The Inklings read work in progress → what private story mattered before them? | Professor Tolkien: circle and Lewis friendship; pub association separately checked |
| 11.55 | 27.72 | West/northwest of the centre; final northern leg | Publisher did not take the mythology; Beren and Luthien were in the offered material → why such attachment? | The Storyteller: mixed reader response and unpublished material |
| 13.20 | 31.68 | Northern approach; NOT Roos, NOT the dance location | Edith's remembered Yorkshire dance inspired the lovers → how does it reach the stone? | War, Lost Tales and Academia: Roos, hemlock, identification with lovers |
| 14.85 | 35.64 | Wolvercote approach; cemetery still ahead | Edith became his Luthien, he her Beren; both names on their joint grave → what do we carry home? | Roos passage; Finis: deaths, burial and inscription |
| 16.15 | 38.76 | Approaching cemetery; track ends beside the cemetery on Five Mile Drive, not at the grave | Opening promise answered; creating a world can preserve love for this one | Recap of sourced facts plus explicitly personal interpretation |

### Source and interpretation boundaries

- The blank-page story is attributed to Tolkien's own account.
- Fiction did not literally transform Edith; the line about fantasy having a heart is interpretation.
- The source supports the Inklings reading work in progress and Lewis's friendship. We do not invent comments they made or claim any particular scene was written in a pub.
- The Tolkien Society's account describes a long route to publication. Sixteen years is not sixteen years of uninterrupted drafting.
- Edith is a person, not a character asset: no claim that her entire life is represented by Luthien.
- The route does not enter the cemetery or imply cycling to the grave is appropriate. Private homes are not visitor attractions.
- Photos use exact Wikipedia subjects. Context chapters may show the person or book under discussion, not a fictional view of the road.

## Reusable local speech workflow

Use `scripts/render-local-guides.py --route-prefix Oxford:`. The implementation requires CUDA rather than silently falling back to CPU. It downloads pinned public Kokoro-82M weights and British male `bm_george` voice to `~/.cache/openride-tts/`, checking upstream SHA-256 and size before accepting them. No paid or hosted TTS calls; no voice cloning. Kokoro is Apache-2.0; retain upstream model/voice provenance.

Use Python **3.12** (Kokoro 0.9.4 rejects Python 3.13+). Create an isolated environment outside the checkout, install the saved requirements, then render:

```sh
python3.12 -m venv ../open-ride-tts-py312
../open-ride-tts-py312/bin/pip install -r scripts/requirements-local-tts.txt
HF_HUB_DISABLE_XET=1 ../open-ride-tts-py312/bin/python scripts/render-local-guides.py --route-prefix Oxford:
```

The renderer preserves other rides, creates standard 44-byte-header mono PCM16 24 kHz WAVs and exact UTF-8 text hashes without newlines, measures audio durations and computes the geometry fingerprint with Node's JSON serialisation. Each `.tts.json` records both text and model/voice/speed identity: changing a voice cannot accidentally reuse an old WAV. `--force` rerecords all chapters. The guide cache ID includes speech identity. `generation.json` reports the actual GPU and peak PyTorch allocation.

The app's captions derive from the exact same `stop.text` passed to speech. A human-readable transcript and caption export are included alongside this note; cue timing in the app remains proportional, not forced-aligned word timing.

### Rebuilding geometry without touching existing rides

Use README's append-one-route recipe with slug `oxford-last-page` on a catalogue that does not yet contain it. Do not run the full geometry builder. Its OSM bicycle routing and Terrarium elevation recipe is checked in; bundled track points are the definitive reviewed geometry (routing services can change later). Run `python scripts/curate-starter-stories.py` for the editorial layer, then the CUDA renderer above. An editorial-only run may reset the guide ID; always finish with the renderer so audio identity is included.

OSM/FOSSGIS road attribution and Mapzen/AWS terrain attribution remain on the route. Elevation uses the existing smoothing recipe, so ascent is an estimate, not a surveyed value.

## Verification and review notes

- Backend tests: 22 passing, including exact exported transcript/caption/GPX consistency and WAV/header/hash checks. Frontend tests: 104 passing. Both production builds pass; Vite retains its existing large-chunk warning.
- All eleven anonymous audio endpoints returned the exact checked-in WAV bytes. Each clip is 26–36 seconds, comfortably within the ten-to-sixty-five-second contract. Final narration totals 342.25 seconds (about 5 minutes 42 seconds).
- A full emulator run unlocked and completed 11/11 stories and reached the finish. Quiet sections were accelerated by advancing the recorder clock; audio was allowed to run in real time. The emulated ride took 34:23 of simulated session time, not a claimed human forty-minute workout. The catalogue estimate is 39.66 minutes at 25 km/h; actual rider pace changes the gaps.
- Three final wording revisions were rechecked separately with the app's actual prepared narrator/caption player. At the reference pace the closing trigger leaves 54.19 seconds of road for a 30.25-second clip: approximately 24 seconds remain after the last word.
- Visible browser inspection checked the opening, automatic warm-up target, caption layout and credited Exeter photo. Final-approach inspection checked Edith's portrait and the cemetery photo. The card reports 62 m raw-model ascent; the ride screen's additional profile smoothing reports 59 m. This is existing app behaviour, not a different track.
- The headed QA browser's native audio backend stalled its audio clock. The complete automated playback check used headless Chromium with hardware audio output disabled, preserving real Web Audio decoding, start/end events and caption timing. **No human ear review is claimed.** The opening and favourite reveal are linked in the PR for that review.
- Local Whisper base.en transcription checked every final clip, with no missing ending in the opening or reveal. This is a content sanity check, not a pronunciation authority or a substitute for listening. Text retains real names; ASR sometimes spells Roos as “ruse” and Dagnall differently. An ambiguous “read” was changed to “share”, and the reveal's final phrase was simplified after the first transcription pass.
- The first transcription attempt omitted `vocabulary.txt`; the second exposed a faster-whisper/PyAV keyword incompatibility. Fetching the actual vocabulary and decoding via local FFmpeg resolved both. These QA tools are not application or TTS-workflow dependencies.
- Gitleaks 8.30.1 found no leaks in the complete 83-commit pre-change history or the working tree, including checked-in assets. Original five catalogue entries and their recordings are preserved.
- Independent code/content review found no blockers. It independently checked the archived historical source, asset hashes, exported captions/GPX and preservation of existing routes. Suggested export-consistency coverage was added. Isolated cache/failure-injection tests for the Python renderer remain a possible follow-up; real initial, incremental and all-cached rendering were exercised.

Re-export review files after any script or voice change:

```sh
node scripts/export-ride-review.mjs Oxford: oxford-last-page
```

The GPX export is a personal geometry-only import; the narrated edition is in **Explore routes**. Nothing is published to the live collection until this PR is merged and the backend is deployed.
