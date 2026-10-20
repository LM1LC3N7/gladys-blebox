# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- BleBox modules over their local HTTP API, without the cloud: added by IP
  address, or found on the network by mDNS (through Gladys), and kept by
  device id when their address changes. Optional HTTP basic authentication.
- wLightBox, wLightBoxS and dimmerBox: on/off, brightness and colour, one
  light per channel in mono mode, two in CTx2 mode.
- switchBox and switchBoxD: relay states and power; a relay is a switch only
  once declared safe in the configuration, read only otherwise.
- shutterBox: open, close, stop, and the position once calibrated (shutters
  and curtains).
- gateBox: open or closed, position, and open, close, stop and second output
  buttons (only the ones its wiring allows), never a switch. Opening is off
  by default. From API 20210118 the gateBox's own `/s/o` and `/s/c` are used
  (it decides on its limit switches, 409 when it cannot tell), and closing
  is always allowed. On an older step-by-step gateBox, closing is the same
  pulse as opening: it needs the opening permission, and is only sent from a
  gate read fully open (fully closed to open). One pulse at a time, and none
  until the gate is seen elsewhere than where the last pulse found it (or a
  few seconds). Stopping is always allowed; stopping and closing cancel a
  pending opening.
- thermoBox: room and probe temperatures, setpoint, heating on/off,
  operating state, safety cut-off. Switching on and the setpoint are off by
  default, the setpoint is bounded by a ceiling (25 °C by default, 30 °C at
  most) and the range of the device; switching off is always sent (`/s/0`,
  no state read).
- The identity of the module at the address is checked before every
  command; a relay removed from the safe list is refused even while its
  command waits.
- A 429/5xx pause holds the reads, the openings and the switching on, never
  closing, stopping or switching off (one try); refused credentials hold
  everything.
- The search: only LAN unicast addresses taken from mDNS, no credentials to
  a module only announced on the network, one scan per 10 s, and a lost
  module searched again every 5 minutes. An announcement never moves a known
  module that still answers at its address, and a module moved by an
  announcement gets no credentials until its address is typed.
- Every gate close or stop cancels, on arrival, an opening or a walk-in
  command not sent yet (step-by-step closes included); the walk-in output
  shares the one-pulse-at-a-time rule and the guard of the gate.
- tempSensor, airSensor (PM2.5, PM10) and multiSensor (temperature,
  humidity, light level, wind, rain, flood, CO2, power, voltage, current).
- Commands decided on a state read just now, sent within 3.5 s or refused
  unsent, "sent, without confirmation" when no answer came back.
- Credentials refused: a stop persisted in `/data`, tried again after 15 min,
  1 h, 6 h then every 24 h; HTTP 429 or 5xx: a pause of 1 min to 6 h; other
  failures: spaced reads, never faster than the refresh interval.
- Reachability on the transport badge, states within the Gladys rate limit,
  measurements spaced by a minute.

[Unreleased]: https://github.com/LM1LC3N7/gladys-blebox/commits/main
