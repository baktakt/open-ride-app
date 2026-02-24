# GitHub Copilot Instructions

Open Ride is a privacy-first indoor cycling app. The browser communicates with ANT+ USB dongles via WebUSB and controls smart trainers using the FE-C protocol. A Node.js backend serves workout files (`.orw` XML) over a REST API. There is no database, no auth, no cloud — user data lives in localStorage.

## Project structure

```
open-ride-app/
├── backend/          # Express API, TypeScript, serves .orw workout files
├── frontend/         # React SPA, JSX, WebUSB ANT+ communication
└── .github/          # GitHub configuration and instructions
```

## Building and testing

### Backend
```bash
cd backend && npm install
npm run build   # TypeScript compile check (tsc)
npm run dev     # Dev server with hot reload on port 3001
```

### Frontend
```bash
cd frontend && npm install
npm run build   # Vite production build check
npm run dev     # Vite dev server on port 3000
```

## Visual verification with Playwright MCP

**Start only the frontend** for visual testing — the backend is not required for UI work because the app has a built-in software emulator that simulates ANT+ hardware.

```bash
cd frontend && npm install && npm run dev
```

Then open the app with the emulator flag:
```
http://localhost:3000?emulator=true
```

With emulator mode active, all ANT+ hardware, trainer simulation, and telemetry are handled entirely in the browser. No backend process is needed.

Use the Playwright MCP tools to take screenshots and verify UI changes after the Vite dev server is ready (it prints "Local: http://localhost:3000" when ready).

## Coding conventions

- **Indentation**: 2 spaces everywhere (JS, JSX, TS, CSS, JSON).
- **Modules**: ES modules (`import`/`export`) — no `require()`.
- **Backend**: TypeScript strict mode, explicit type annotations, interfaces over type aliases.
- **Frontend**: Functional React components only, PascalCase component filenames, camelCase service filenames.
- **CSS**: Plain CSS, one file per page in `frontend/src/styles/`, no preprocessors.
- **State**: React Context + localStorage. No Redux/Zustand.
- **No semicolons omitted** — semicolons are used consistently.

## What NOT to do

- Do not add new dependencies without explicit approval.
- Do not add TypeScript to the frontend (JSX only, not TSX).
- Do not add class components, Redux, Zustand, analytics, or external API calls.
- Do not modify `.env` files without asking.
- Do not start the backend when only doing frontend/UI work — use emulator mode instead.
