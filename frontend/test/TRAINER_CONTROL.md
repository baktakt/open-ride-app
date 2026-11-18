# Trainer-control regression coverage

Run from `frontend/`:

```sh
node --test test/antManagerWebUSB.test.js test/trainerControl.test.js test/workoutFeedback.test.js
npm test
npm run build
```

The ANT tests instantiate the **real installed ant-plus-next sensor** against a fake EventEmitter USB stick. They inject binary channel events into the library's normal `read` entry point, rather than mocking command success. Fake timers deterministically inject absent acknowledgements and missing channel-open/close responses. Other cases inject rejected USB writes, unsolicited detachment, USB shutdown, overlapping requests and cancellation during reconnection. The recovery integration uses the real `recoverRideTrainer` service.

## Root causes

- ant-plus-next 0.4.0's BaseSensor status handler handles RF `EVENT_RX_FAIL` (`msg=0x01`, `code=0x02`) by shifting `messageQueue` and calling its callback with false. This event means a missed received broadcast, not a failed outbound acknowledged transfer. The compatibility sensor ignores only that event; actual TX failure (`0x06`) and completion (`0x05`) retain their meanings. Review this shim when upgrading the library: it deliberately wraps its TypeScript-private/runtime-visible `statusCbk` seam.
- Library send promises resolve at queue acceptance. A real radio ACK is required; telemetry, power tracking, or a resolved write promise must not substitute for it. The application's old timeout returned false without removing the library's queued command. Retrying accumulated stale workloads. The manager now serializes one command, keeps only the newest unsent target, and retires an uncertain channel instead of reusing its queue.
- Sensor `attach()` resolves after channel assignment is written, not when the channel has opened. Connect now waits for `attached`, with a bounded timeout and cancellable stale-session handling. Disconnect cancels pending work and waits for channel unassignment before a new sensor can use channel zero. Missing teardown responses surface a USB error rather than pretending the channel is reusable.
- USB shutdown left the sensor/device identity alive, and reinitialization overwrote an existing USB driver without closing its claimed interface. Both paths now release/invalidate old resources.
- Workout notices were normal-flow paragraphs above the main ride UI. Their appearance and removal reflowed all controls. Fixed-position, pointer-transparent notices retain real failure messages without shifting the workout.

## Browser regression

`workoutFeedback.test.js` uses installed Chromium/Chrome (or `CHROME_BIN`) and Node's built-in WebSocket/CDP; no additional dependency is installed. It mounts the real WorkoutPage with a hardware-boundary fixture, injects repeated failed commands, restores acknowledgements, disconnects and reconnects. It asserts unchanged workout geometry at desktop and narrow/mobile widths. Retry delays are accelerated only inside this test fixture. Browser tests require Node with built-in WebSocket (Node 22+); without Chrome this test is explicitly skipped.

## Hardware limits

These are software fault-injection tests, not physical ANT+/WebUSB verification. They cannot establish actual RF quality, dongle firmware behavior, trainer FE-C compliance, USB permissions/OS-driver behavior, or trainer load accuracy. An ANT radio ACK confirms delivery, not that the requested load was physically applied. Validate with a real dongle/trainer before release: sustained ERG/ramp and resistance segments, pause/resume, temporary RF loss, USB unplug/replug, and recovery without stale load replay. No production deployment is part of this change.
