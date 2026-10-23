# CLAUDE.md

Instructions for Claude Code and Claude-based agents working on the Open Ride codebase.

## Quick start

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

The app is then available at http://localhost:3000. Use `?emulator=true` in the URL to enable the ANT+ emulator (no hardware needed).

## What this project is

Open Ride is a privacy-first indoor cycling app. The browser talks to an ANT+ USB dongle via WebUSB and communicates with smart trainers using the FE-C protocol. A Node.js backend serves workout files (`.orw` XML) over a REST API. There is no database, no auth, no cloud -- user data lives in localStorage.

## What not to do

- Do not add dependencies without explicit approval. The package.json files are intentionally small.
- Do not add a linter, formatter, or pre-commit hook unless asked. The project has none by design.
- Do not add TypeScript to the frontend. The frontend uses JSX (not TSX). The backend is TypeScript.
- Do not introduce class components. All React components are functional.
- Do not add Redux, Zustand, or other state libraries. State is managed via React Context and localStorage.
- Do not add analytics, telemetry, or external API calls. Privacy is a core principle.
- Do not create or modify `.env` files without asking. The backend `.env` holds PORT and HOST, and optionally LM_USER / LM_PASS (a Geotorget login for Lantmäteriet's terrain model; never log or return them).
- Do not run `npm run build` during iterative development -- use `npm run dev` for hot reload.

## Code style rules

**Indentation**: 2 spaces. Always.

**Imports**: ES modules only. No `require()`. Order: external packages first, then local modules, then CSS.

**Backend (TypeScript)**:
- Strict mode. Annotate function params and return types.
- Use interfaces for object shapes, discriminated unions for variants.
- Prefix unused Express handler params with underscore: `(_req, res)`.
- File names: camelCase (`workoutParser.ts`).

**Frontend (React JSX)**:
- File names: PascalCase for components (`WorkoutPage.jsx`), camelCase for services (`antManager.js`).
- Destructure props in function signature.
- Wrap callbacks in `useCallback`, derived values in `useMemo`.
- Use `useRef` for high-frequency data (telemetry) to avoid render storms.
- One CSS file per page in `frontend/src/styles/`. Import at top of component.

**CSS**:
- Plain CSS. No preprocessors, no CSS modules, no styled-components.
- Use the existing color scheme: dark backgrounds (`#0a0a0a`, `#1a1a2e`), cyan accent (`#00d4ff`).

## Key architecture decisions

1. **WebUSB in browser** -- ANT+ USB communication runs client-side via `ant-plus-next`. The backend does NOT handle USB.
2. **Singleton ANT manager** -- `getAntManager()` in `services/antManager.js` returns a cached instance (WebUSB or Emulator depending on settings).
3. **EventEmitter pattern** -- Both ANT manager implementations emit `status`, `telemetry`, and `device_discovered` events. The `AntContext` subscribes to these.
4. **File-based workouts** -- `.orw` XML files in `backend/workouts/`. No database. Parsed on startup with `fast-xml-parser`.
5. **localStorage persistence** -- Settings, workout history, and training programs are stored under `openride_*` keys.

## Running and verifying changes

Pure logic (metrics, recorder, telemetry merge, workout parsing) has unit tests using Node's built-in test runner — no extra dependencies:

```bash
cd frontend && npm test   # frontend/test/*.test.js
cd backend && npm test    # backend/test/*.test.ts (via tsx)
```

UI and hardware behaviour must still be verified manually:

```bash
# Start backend (terminal 1)
cd backend && npm run dev

# Start frontend (terminal 2)
cd frontend && npm run dev

# Open http://localhost:3000?emulator=true in Chrome
```

For backend-only changes, verify the API:
```bash
curl http://localhost:3001/api/status
curl http://localhost:3001/api/workouts
curl http://localhost:3001/api/workouts/categories
```

For TypeScript compilation checks:
```bash
cd backend && npm run build
```

For frontend build checks:
```bash
cd frontend && npm run build
```

## File map for common changes

| Want to... | Edit these files |
|------------|-----------------|
| Add a new page | `frontend/src/pages/NewPage.jsx`, `frontend/src/styles/newpage.css`, `frontend/src/App.jsx` |
| Add an API endpoint | `backend/src/index.ts`, optionally `backend/src/types.ts` |
| Change ANT+ behavior | `frontend/src/services/antManagerWebUSB.js` (real) or `antManagerEmulator.js` (emulated) |
| Add a workout segment type | `backend/src/workoutParser.ts` (interfaces + parsing), `frontend/src/pages/WorkoutPage.jsx` (rendering + execution) |
| Change global state | `frontend/src/contexts/AntContext.jsx` |
| Change navigation | `frontend/src/components/TopBar.jsx` |
| Add a new workout | Create `.orw` file in `backend/workouts/` following XML format in README |
| Change user settings | `frontend/src/pages/SettingsPage.jsx` (localStorage key: `openride_settings`) |
| Change the 3D route view | `frontend/src/components/Route3DView.jsx` (three.js scene), `frontend/src/services/terrain.js`, `frontend/src/services/routeScene.js` |
| Add a terrain data provider | `backend/src/terrainTiles.ts` (must serve 256×256 terrarium-encoded PNG tiles) |

## 3D route view and terrain

- `three` is the only 3D dependency and is lazy-loaded (`React.lazy`) so it stays out of the main bundle.
- The browser never calls map-data providers directly. Elevation tiles come from the backend proxy
  `GET /api/terrain/:provider/:z/:x/:y.png`, which fetches or renders them and caches them under `backend/cache/` (gitignored).
- `GET /api/terrain/providers` lists the available providers best first. `lantmateriet` (1 m, Sweden) is only offered when
  LM_USER / LM_PASS are set; it is rendered from Lantmäteriet's Cloud-Optimized GeoTIFFs (`backend/src/lantmateriet/`) and
  falls back per pixel, and on any error, to `terrarium` (AWS Terrain Tiles, global). Lantmäteriet answers 403 when hit
  too hard: keep requests to it at two at a time.

## localStorage keys

| Key | Content |
|-----|---------|
| `openride_settings` | User profile: FTP, max HR, weight, units, etc. |
| `openride_workout_history` | Array of completed ride summaries |
| `openride_training_program` | Weekly training schedule |
| `openride_use_emulator` | `"true"` or `"false"` -- enables emulator mode |
| `openride_was_connected` | `"true"` if previously connected to USB dongle (triggers auto-reconnect) |

## IndexedDB

Large data lives in the `openride` IndexedDB database. Always open it through `frontend/src/services/db.js` (single version + upgrade handler for all stores).

| Store | Content | Module |
|-------|---------|--------|
| `routes` | Saved GPX routes | `services/routeLibrary.js` |
| `rides` | Per-second ride recordings (id = history entry id), exported as FIT/TCX by `services/rideExport.js` | `services/rideFiles.js` |
