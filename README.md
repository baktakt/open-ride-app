

# Open Ride

An open-source indoor cycling app that connects to smart trainers directly from the browser — via **ANT+ USB** or **Bluetooth LE**. Run structured workouts or free-ride sessions with live power, cadence, speed, and heart rate data.

No account required. No cloud. No subscription.

---

## How it works

The React frontend talks to your trainer using one of two browser APIs. A lightweight Node.js backend serves the pre-built workout library.

### ANT+ (via WebUSB)

```
Browser (React + WebUSB)  ←── USB ──→  ANT+ Dongle  ←── 2.4 GHz ──→  Trainer
         ↕ REST API
    Node.js Backend (workout files)
```

Open Ride uses [ant-plus-next](https://github.com/Benjamin-Stefan/ant-plus-next) to speak the FE-C protocol directly over the Garmin USB dongle — no native app, no driver (except on Windows, see [USB dongle setup](#usb-dongle-setup)).

### Bluetooth LE (via Web Bluetooth)

```
Browser (React + Web Bluetooth)  ←── BLE ──→  Trainer
         ↕ REST API
    Node.js Backend (workout files)
```

Open Ride implements the **FTMS** (Fitness Machine Service, UUID `0x1826`) and **CPS** (Cycling Power Service, UUID `0x1818`) Bluetooth profiles. The browser's native device picker handles pairing — no dongle needed.

---

## Requirements

**Software**
- Node.js 18 or later
- A Chromium-based browser: Chrome, Edge, or Opera (see [Browser support](#browser-support))

**Hardware** — choose one, or use the [emulator](#without-hardware-emulator)

| Option | What you need |
|--------|--------------|
| **Bluetooth LE** | Any FTMS-compatible smart trainer (most trainers from 2018 onwards) |
| **ANT+** | A Garmin ANT+ USB stick (USB-2 or USB-m) + an FE-C compatible trainer |

---

## Setup

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

---

## Running

### With a real trainer

```bash
# Terminal 1 — backend API
cd backend
npm run dev

# Terminal 2 — frontend
cd frontend
npm run dev
```

Open the frontend URL in Chrome/Edge/Opera, then click the connection button in the top bar to open the device panel and connect.

### Without hardware (emulator)

Enable emulator mode in the Settings page, or append `?emulator=true` to the URL. This simulates a dongle and three virtual trainers with realistic physics — everything works the same as with real hardware. See [EMULATOR_GUIDE.md](EMULATOR_GUIDE.md) for details.

---

## Connecting a trainer

### Bluetooth LE

1. Click the connection button in the top bar
2. Select the **Bluetooth** tab in the device panel
3. Click **Find Trainer** — your browser opens its native Bluetooth picker, pre-filtered to FTMS and CPS devices
4. Select your trainer and click **Connect**

No drivers or additional setup required. The browser manages pairing and reconnection prompts if the connection drops.

**Supported profiles:**

| Profile | UUID | What it provides |
|---------|------|-----------------|
| FTMS (Fitness Machine Service) | `0x1826` | Power, cadence, speed, distance, elapsed time — plus full ERG/resistance control |
| CPS (Cycling Power Service) | `0x1818` | Power readings only (no trainer control — useful for power meters) |

Most modern smart trainers advertise FTMS: Wahoo KICKR, Tacx Neo/Flux, Elite Suito/Direto, Saris H3, and many others.

### ANT+

1. Plug in your Garmin ANT+ USB dongle
2. Click the connection button in the top bar
3. Select the **ANT+** tab and click **Start Scan**
4. Your trainer appears in the list — click **Connect**

The browser remembers the dongle permission. On the next visit it reconnects automatically if the dongle is already plugged in.

---

## USB dongle setup (ANT+ only)

WebUSB requires HTTPS or `localhost`, and a Chromium-based browser.

### macOS

No driver install needed. If Garmin Express or ANT Agent is installed, close it before starting Open Ride — it claims the USB device. If you still get errors:

```bash
sudo kextunload -b com.garmin.ant.usbdriver
```

### Linux

Add a udev rule so the browser can access the dongle:

```bash
sudo tee /etc/udev/rules.d/51-garmin-usb.rules << 'EOF'
SUBSYSTEM=="usb", ATTR{idVendor}=="0fcf", ATTR{idProduct}=="1008", MODE="0666"
SUBSYSTEM=="usb", ATTR{idVendor}=="0fcf", ATTR{idProduct}=="1009", MODE="0666"
EOF

sudo udevadm control --reload-rules
sudo udevadm trigger
```

Unplug and replug the dongle after applying.

### Windows

Windows ships a Garmin driver that blocks WebUSB. Replace it with WinUSB using [Zadig](https://zadig.akeo.ie/):

1. Run Zadig → Options → List All Devices
2. Select your ANT+ stick (usually "ANT USBStick2")
3. Choose **WinUSB** as the replacement driver
4. Click **Replace Driver**

To go back to Garmin Express later, use Device Manager to restore the original driver.

---

## Browser support

Open Ride uses two browser hardware APIs. Both require a Chromium-based browser.

| Browser | ANT+ (WebUSB) | Bluetooth LE (Web Bluetooth) |
|---------|:---:|:---:|
| Chrome / Chromium | ✅ | ✅ |
| Edge (Chromium) | ✅ | ✅ |
| Opera | ✅ | ✅ |
| Firefox | ❌ | ❌ |
| Safari | ❌ | ⚠️ Partial (macOS 15+ / iOS 17.4+, experimental) |

HTTPS or `localhost` is required for both APIs.

---

## Features

### Structured Workouts

Follow structured training sessions with automatic ERG mode control. The app adjusts trainer resistance in real time to hit the target power for each segment. Live metrics show power, cadence, speed, and heart rate throughout the ride.

### Effort Adjust

During a workout, scale interval intensity by ±10% (90%–110%) without changing your FTP. Useful for hard or easy days.

### Route Rides

Ride real outdoor routes on your indoor trainer using GPX files:

- Upload a GPX file exported from Strava, Komoot, Garmin Connect, RideWithGPS, or any other cycling app
- An interactive map shows the route and your current position
- An elevation profile canvas displays a live progress marker
- Trainer resistance adjusts automatically to match the road gradient in real time (climbs increase resistance, descents decrease it)
- Live stats: distance ridden, current elevation, current grade, power, cadence, and duration
- Completed rides are saved to your route history
- Saved routes can be added to your weekly Training Program alongside structured workouts

Routes are stored in the browser's **IndexedDB** (not localStorage) because parsed GPX files can be several hundred KB. Nothing leaves your browser.

### Training Program

Plan your week by assigning workouts and route rides to each day of the week. Drag and drop to rearrange. The Training page shows today's scheduled sessions at a glance.

### AI Workout Generator

Generate a personalised workout on the fly using an LLM. Answer a few questions — duration, training goal, intensity, fitness level — and the AI creates a structured `.orw` workout tailored to you.

- Bring your own API key (OpenAI or Anthropic) — **this is entirely optional**; the key is stored only in your browser and sent directly to the AI provider; it never touches Open Ride servers
- Generated workouts are saved to **My Workouts** and stored in `localStorage` — no account or backend needed
- Works offline after first generation (saved workouts persist locally)

> **API key security notice:** Bringing your own API key is optional and should be done with caution.
> Your key is stored in your browser's `localStorage` and is readable by anyone with access to
> DevTools on your machine. Browser extensions may also be able to read it. Open Ride loads no
> external scripts, which removes the main XSS vector, but you remain responsible for the security
> of your own device and browser environment.
> **The authors and contributors of Open Ride accept no liability for any leakage, theft, or
> unauthorized use of API keys entered into this application.**
> If you use a shared or public computer, use private/incognito mode and clear site data when done.

### My Workouts

AI-generated and custom workouts live in your browser's `localStorage` under the **My Workouts** category. They appear on the home page and in the Training Program day picker alongside the pre-built workout library.

### Export & Import

Back up all your data — settings, ride history, training program, and saved workouts (including raw XML) — to a JSON file. Import it on any device or browser to restore your full setup.

Go to **Settings → Data Management** to export or import.

### Free Ride

Ride without a structured plan. Tracks power, cadence, speed, heart rate, distance, and calories in real time.

---

## Workouts

Pre-built workouts live in `backend/workouts/` as `.orw` XML files. Drop a new file in that folder and reload the page — it appears automatically.

A workout file looks like this:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <name>My Workout</name>
  <description>A short description</description>
  <category>Endurance</category>
  <tags>
    <tag name="Endurance"/>
    <tag name="Zone 2"/>
  </tags>

  <workout>
    <Warmup Duration="300" PowerLow="0.40" PowerHigh="0.60" Cadence="85">
      <textevent timeoffset="0" message="Let's warm up!"/>
    </Warmup>

    <SteadyState Duration="600" Power="0.75" Cadence="90">
      <textevent timeoffset="0" message="Settle into tempo pace."/>
    </SteadyState>

    <IntervalsT Repeat="5" OnDuration="60" OffDuration="60" OnPower="1.10" OffPower="0.55" Cadence="95" CadenceResting="85">
      <textevent timeoffset="0" message="GO! Push hard!"/>
      <textevent timeoffset="60" message="Recover."/>
    </IntervalsT>

    <Cooldown Duration="180" PowerHigh="0.45" PowerLow="0.30" Cadence="75"/>
  </workout>
</workout_file>
```

**Power values are fractions of FTP** (configured in Settings). `0.75` = 75% of your FTP. Duration is always in seconds.

**Available segment types:**

| Element | Description |
|---------|-------------|
| `Warmup` | Ramp from `PowerLow` to `PowerHigh` |
| `Cooldown` | Ramp from `PowerHigh` down to `PowerLow` |
| `SteadyState` | Hold a single `Power` value |
| `Ramp` | Ramp between `PowerLow` and `PowerHigh` |
| `IntervalsT` | Repeating on/off intervals (`Repeat`, `OnDuration`, `OffDuration`, `OnPower`, `OffPower`, plus optional `Cadence` and `CadenceResting`) |
| `FreeRide` | No target power — ride at your own pace |
| `MaxEffort` | All-out sprint — no power target, duration only |

Add `<textevent>` elements inside any segment to show coaching messages at specific times (seconds from segment start).

---

## Route Rides

Upload any GPX file that contains a track with elevation data to ride it on your trainer. The app parses the file client-side — no upload to any server.

**Supported GPX sources:** Strava, Komoot, Garmin Connect, RideWithGPS, and any app that exports standard `.gpx` files with `<trkpt>` elements.

**Elevation requirement:** The GPX file must include `<ele>` elements for automatic grade control to work. Routes without elevation data can still be ridden but resistance will not change.

**How grade control works:**

```
GPX elevation data  →  calculate gradient between track points
                    →  send grade % to trainer via FE-C / FTMS
                    →  trainer adjusts resistance in real time
```

Progress along the route is tracked using your reported speed (from the trainer). The app advances your position along the track proportionally, then looks up the gradient at that location.

**Storage:** Saved routes live in the browser's IndexedDB under the `openride` database, `routes` store. They are scoped per user profile. Route ride history (completed ride summaries) is stored in localStorage under `openride_route_history`.

---

## Troubleshooting

### Bluetooth

**Trainer not appearing in the browser picker**
- Make sure the trainer is powered on and not connected to another device (phone app, Garmin head unit, etc.).
- The picker only shows FTMS/CPS devices — if your trainer is very old it may not advertise those profiles.
- Try forgetting the device in your OS Bluetooth settings and pairing fresh.

**"Web Bluetooth not available"**
- Use Chrome, Edge, or Opera.
- Make sure you're on HTTPS or `localhost`.
- On Linux, Web Bluetooth requires `chrome://flags/#enable-web-bluetooth` to be enabled in some older Chrome versions.

**Connected but no power data**
- Pedal the trainer — most trainers only transmit while moving.
- If your trainer uses CPS only (power meter, not a smart trainer), resistance/ERG control will not be available.

### ANT+

**No devices found after scanning**
- Is the dongle plugged in? (Check `lsusb` on Linux.)
- Did you run the USB setup for your OS above?
- Wake the trainer up by pedaling for a few seconds.
- Make sure you're using a Chromium-based browser.

**"Failed to open USB device"**
- macOS: Close Garmin Express / ANT Agent.
- Windows: Re-run Zadig, make sure WinUSB is selected, try a different USB port.
- Linux: Check the udev rule was applied (`sudo udevadm monitor` while plugging in).

**Device connects but no telemetry**
- Pedal the trainer — most trainers only transmit while moving.
- If using a Wahoo, make sure it's not paired exclusively to the Wahoo app.

**Browser shows "WebUSB not supported"**
- Use Chrome, Edge, or Opera. Firefox and Safari do not support WebUSB.
- Make sure you're on HTTPS or `localhost`.

---

## Project layout

```
open-ride-app/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Server entry point, REST API routes
│   │   ├── workoutParser.ts       # .orw XML parser
│   │   └── types.ts               # Shared TypeScript types
│   └── workouts/                  # Pre-built workout files (.orw)
├── frontend/
│   ├── src/
│   │   ├── main.jsx               # App entry point (React + Vite)
│   │   ├── App.jsx                # Router setup
│   │   ├── pages/
│   │   │   ├── HomePage.jsx           # Workout library + My Workouts
│   │   │   ├── WorkoutPage.jsx        # Structured workout runner
│   │   │   ├── FreeRidePage.jsx       # Free ride mode
│   │   │   ├── RoutePage.jsx          # GPX route ride (map + elevation + grade control)
│   │   │   ├── TrainingProgramPage.jsx # Weekly training planner (workouts + routes)
│   │   │   ├── AiWorkoutPage.jsx      # AI workout generator
│   │   │   └── SettingsPage.jsx       # User settings & data management
│   │   ├── components/
│   │   │   ├── TopBar.jsx             # Navigation bar (desktop + mobile)
│   │   │   ├── DeviceModal.jsx        # ANT+ / Bluetooth device panel
│   │   │   └── TelemetryDisplay.jsx
│   │   ├── contexts/
│   │   │   └── AntContext.jsx         # Shared trainer state (ANT+ + BLE)
│   │   ├── services/
│   │   │   ├── antManager.js              # Manager factory (WebUSB vs emulator)
│   │   │   ├── antManagerWebUSB.js        # ANT+ via WebUSB + ant-plus-next
│   │   │   ├── antManagerEmulator.js      # Client-side trainer emulator
│   │   │   ├── bluetoothManagerWebBluetooth.js  # BLE via Web Bluetooth (FTMS/CPS)
│   │   │   ├── routeLibrary.js            # IndexedDB storage for GPX routes
│   │   │   ├── aiWorkoutGenerator.js      # LLM workout generation
│   │   │   ├── workoutParser.js           # Browser-side .orw XML parser
│   │   │   └── dataManager.js             # localStorage CRUD + export/import
│   │   └── styles/                # CSS stylesheets
│   └── index.html
├── CONTRIBUTING.md
├── EMULATOR_GUIDE.md
├── WEBUSB_MIGRATION.md
└── README.md
```

---

## References

- [ant-plus-next](https://github.com/Benjamin-Stefan/ant-plus-next) — ANT+ library used for trainer communication
- [WebUSB API](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API) — browser API for USB device access
- [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API) — browser API for BLE device access
- [FTMS Specification](https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/) — Fitness Machine Service Bluetooth profile
- [ANT+ FE-C Device Profile](https://www.thisisant.com/developer/resources/downloads/) — ANT+ trainer protocol spec
- [Zadig](https://zadig.akeo.ie/) — USB driver replacement tool for Windows

---

## License

[MIT](LICENSE)
