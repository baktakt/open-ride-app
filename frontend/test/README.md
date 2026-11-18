# Frontend tests

Run `npm test` from `frontend/` for the full Node suite.

## Route lifecycle browser regression

```sh
node --test test/rideLifecycle.test.js
```

Requires Node 22+ (built-in `WebSocket`) and installed Chrome/Chromium. Set
`CHROME_BIN=/path/to/chromium` if it is not on PATH. The test reports a skip
when no browser is installed; no browser automation dependencies are added.

The runner starts an ephemeral Vite server and headless browser with an isolated
temporary profile, then cleans both up. It exposes the actual `AppShell` through
a test-only Vite transform, leaving production exports unchanged.

The fixture mounts the real React shell, router, ride session provider and route
page. It runs the real recorder and checks localStorage history and IndexedDB
recordings. Only the trainer context, network replies, map tiles/animations and
recorder clock are controlled. No backend, credentials or USB hardware is used.

Covered behaviors:

- Stop a recorded ride, return home, and start a different route.
- Automatically finish a route, return home, and start a different route.
- Preserve the completed history and recording after leaving the summary.
- Discard a short ride (under 0.1 km) without saving or retaining a session.
- Clear the summary through Ride Again and start a fresh session.
- Navigate home during an active or paused ride without ending it; keep recording
  while hidden, block another route, and return to the original ride.

This is a lifecycle regression, not a USB integration, map-animation, backend API
or visual-layout test. Route rides have automatic saving, not separate Save and
Discard buttons; the short-ride path is the existing discard behavior.
