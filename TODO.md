# TODO — BleBox v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only.

## Status

- [x] **Milestone 1 — local API** (2026-10-20): addresses typed or found by
      mDNS (`scanNetwork`), identity by `/api/device/state` (`/info`),
      paths by product type and API level (ported from blebox-uniapi),
      registry kept in `/data` by device id, polling, lights, relays (safe
      ones only), shutters, gate (buttons, opening off by default), thermoBox
      (heating commands off by default, ceiling), sensors, blocks persisted
      (credentials, pauses), transport badges, manifest, docs en/fr. Tested
      against sample answers and fakes only. The store validator was not run
      by the development agent (it cannot): to run from the real terminal.
- [x] **Review 1 fixes** (2026-10-20): B1, I1-I5, M1-M6 of the review (see the Decisions).
- [ ] **Milestone 2 — real hardware** (testers with the modules): record real
      answers as fixtures, fix what differs. To check first:
  - the mDNS service `_bbxsrv._tcp` and the port it gives;
  - the answer of the `/s/...` commands (the state of the module, as
    assumed for the relays?) and of `POST /api/rgbw/set`;
  - gateBox: `/s/o` and `/s/c` (answer, 409), `gatePulseTimeMs` for the
    guard, `currentPos` without limit switches (-1 always?), the legacy
    API (`/api/gate/state`) and whether a step-by-step pulse at 100 % always
    closes;
  - thermoBox: `operatingState` values (mapped as Home Assistant: 1 heating,
    2 cooling, 0 and 3 idle), the safety sensor, a device in cooling mode;
  - shutterBox: `currentPos.position` -1 when unknown, curtains and awnings;
  - wLightBox: `--` masks accepted on every firmware, effects (`effectID`)
    left running by a colour command?, RGBWW channel order (blebox-uniapi
    swaps WW and CW);
  - a module protected by a password: 401 or 403.
- [ ] **Milestone 3 — more**: energy index of switchBox / multiSensor
      (`forwardActiveEnergy`) with the approved guard of gladys-p1-monitor
      (`src/guard.js`, as is), PM1 (no Gladys category yet), shutter tilt,
      wLightBox white temperature (CT) and effects, saunaBox (a heater:
      commands off by default, bounded), gateController and tvLiftBox
      (buttons), a "forget a device" action.
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, then the store validator once the image is published.

## Decisions

- Forum: no dedicated topic, no post from this module's work; one recap per
  wave in /t/10385, posted by the main session.
- Reuse: blebox-uniapi (Apache-2.0, BleBox, used by Home Assistant core) is
  Python, so its types, paths and scales are ported, not imported; no
  runtime dependency besides the SDK. Credited in `THIRD_PARTY_NOTICES.md`
  (copied into the image with `LICENSE`).
- Version 0.1.0 in `package.json`, `package-lock.json`, the manifest and the
  `docker_image` tag, set by hand at milestone 1 (the template's 1.0.0 was
  someone else's). The first release (patch) gives 0.1.1; every later
  version comes from the Release workflow.
- External ids: `gladys.externalIds('blebox', id)`, `id` being the
  hexadecimal id of `/api/device/state` (lower case). Feature keys are
  frozen: `relay-<n>`, `relay-<n>-state`, `power`, `voltage`, `state`,
  `position`, `gate`, `open`, `close`, `stop`, `second-output`,
  `temperature`, `probe-<id>`, `target`, `mode`, `operating-state`,
  `safety`, `pm25`, `pm10`, `<type>-<id>` (multiSensor), `light[-n]`,
  `brightness[-n]`, `color[-n]`.
- Relays: a relay may feed a pump, a heater or a gate motor, and a "turn
  everything off" reaches every `switch`. So a relay is a `switch` only when
  declared safe (`safe_relays`: `<id>` or `<id>:<relay>`), else a read-only
  `unknown`/`binary` state. A created feature is never removed: a relay no
  longer declared safe keeps its `switch` feature, whose commands are
  refused.
- Gate: never a `switch` nor a commandable `binary`; an `opening-sensor`
  (closed at 0 %), a read-only position, and `button`/`push` features, only
  the ones the wiring allows (no close in only-open mode, a stop only when
  the second output is a stop outside open/close mode; a created one is
  kept). Opening and the second output (walk-in, other; usable without
  `openCloseMode`, as on API 20200831-20221231) need "Allow opening the
  gate" (off by default), checked on arrival, after the fresh read and in
  `beforeSend`.
  - Review 1 decision (B1): from API 20210118, open is `/s/o` (option) and
    close is `/s/c` (always allowed, the module decides on its limit
    switches, 409 -> "refused, neither fully open nor closed"); the state is
    still read first. Open/close mode on an older API: close is the second
    output, always allowed. Step-by-step (or unknown mode) on an older API:
    the primary output steps (open, stop, close, stop), so the close pulse
    IS the open pulse: it needs "Allow opening the gate" too (checked again
    in `beforeSend`), and is only sent from 100 % (open from 0 %).
  - Review 1 (I1): one pulse (`/s/p`, `/s/o`, `/s/c`) at a time per gate,
    the second one refused; after a pulse that may have left, a guard keeps
    the starting position and refuses any pulse until a position read is
    different (never lifted on an unknown or equal one) or it expires
    (pulse length + 8 s, 20 s at most). Recent APIs give no `desiredPos`:
    a move is never known, only the limit switches (0, 50, 100, -1).
  - Stop (`/s/s`, second output read as "stop" just now) is never blocked
    and, with a close that cannot open, cancels an opening or a heating
    command not sent yet.
- thermoBox: its output may drive any heater, so it is never a switch: a
  thermostat `mode` (0 off, 1 heating, 2 cooling) and `target-temperature`.
  Switching off (review 1, I3): identity checked, then `/s/0` always sent
  (idempotent), never a state read nor "already off". Switching on and the
  setpoint need "Allow the heating commands" (off by default); the setpoint
  is bounded by max(5 °C, device minimum) and min(ceiling, 30 °C, device
  maximum), the ceiling 25 °C by default, 10 to 30 °C. Switching on never
  changes the device's own mode (a heater is never switched on as a
  cooler). The room sensor is the lowest id that is not the safety sensor;
  the others are `probe` temperatures (out of the room average).
- Commands: the id at the address is checked before EVERY command (review
  1, I4: a DHCP swap must never switch another module); gate, heating on,
  setpoint, lights decided on a state read just now (never in memory); sent
  within 3.5 s of the click or refused unsent; answered by 4.3 s; a request
  that may have left (silence, dropped connection, 5xx, an answer that is
  not JSON) is "sent, without confirmation"; never retried. One queue per
  device; the ack never waits for a publication (an unknown feature is
  refused, never a publication awaited; a command before the first start is
  a refusal). A relay command carries its relay: the safe list is checked
  again on arrival, after the queue and in `beforeSend` (I5). One series of
  reads after a command per device (1.5, 6, 20 s), sharing a read in
  progress.
- Failures: 401/403 = credentials refused (a stop persisted per address:
  15 min, 1 h, 6 h, then every 24 h; other credentials or the search asked
  by the user try again; a background search does not); 429 or 5xx = a
  pause of 1 min to 6 h (Retry-After, else doubling), persisted and capped
  when read back, holding the reads, the openings and switching on; review
  1 decision (I2): closing (`/s/c` or a separate output), stopping and
  switching off ignore a pause (one try), refused credentials still hold
  them. Other failures: 30 s, 1, 2, 5 min, never faster than the interval;
  an address that never answered is asked again every max(1 min, interval).
  A reconnection to Gladys clears none of them, and publishes the status
  and the Discovery tab again.
- Search (review 1, M6): only LAN unicast IPv4 from mDNS (no loopback,
  0.x, link-local, multicast, .0, .255); the credentials only go to typed or
  already known addresses (an announced protected module is named in the
  status, to be typed); one scan per 10 s (the last results reused); a lost
  module (unreachable or address taken) searched again every 5 minutes.
- Approval round 1 (I6, m1-m4): every gate close and stop cancels, on
  arrival and before any queue, the opening and walk-in tickets not sent
  yet (cancelling sends nothing); the walk-in output is a pulse too (one at
  a time, guarded); "just commanded" advises Stop only when the gateBox has
  a stop output; an anonymous (announced) probe never moves a record whose
  address still answers with that id, and a record moved that way is
  `untrusted`: no credentials until its address is typed; docs: `/s/c`
  depends on the limit switches, check the state in the wBox app.
- /data (review 1, M3): block keys must be addresses (`__proto__` is not);
  a record is kept only if its type, API level, kind, address and layout
  agree. A firmware update (another `apiLevel` at the same id) moves the
  paths with it.- Energy: no index in v1 (the approved guard of gladys-p1-monitor is not
  wired yet); `forwardActiveEnergy` and the switchBox `powerConsumption`
  (energy over a period, not an index) are not published.
- Units: only the ones the core lists for the category
  (`DEVICE_FEATURE_UNITS_BY_CATEGORY`); none on the light, shutter, button,
  thermostat mode and unknown features.
- Lights: one Gladys light per group of channels (colour mode); a command
  writes only its channels, the others masked `--` (as blebox-uniapi);
  brightness 0 turns off; turning on uses `lastOnColor`; a colour keeps the
  brightness and turns the whites off.
- Answers: 64 KB at most, parsed once with `JSON.parse`, own properties only
  (`Object.hasOwn`), every number checked; texts from the device stripped
  of control characters and cut.
- Polling 5 s to 300 s (default 10 s).
