# BleBox for Gladys Assistant

This integration shows your BleBox Wi-Fi modules in Gladys and controls them
through their local HTTP API, on your network, without the BleBox cloud.

**Never tested with a real device**: the integration follows the API
documentation and the manufacturer's blebox-uniapi library, but nobody has
tried it on a real module yet. Feedback is welcome.

Unofficial integration, not affiliated with BleBox.

## Supported modules

| Module                | In Gladys                                                        |
| --------------------- | ---------------------------------------------------------------- |
| wLightBox, wLightBoxS | light: on/off, brightness, colour (depending on the colour mode) |
| dimmerBox             | light: on/off, brightness                                        |
| switchBox, switchBoxD | relays (read only until declared safe), power                    |
| shutterBox            | shutter or curtain: open, close, stop, position (if calibrated)  |
| gateBox               | gate: open/closed, position, open, close and stop buttons        |
| thermoBox             | temperature, probe, setpoint, heating on/off, safety cut-off     |
| tempSensor            | temperature                                                      |
| airSensor             | PM2.5 and PM10                                                   |
| multiSensor           | temperature, humidity, light level, wind, rain, flood, CO2…      |

## Setup

1. Give each module a fixed IP address in your router.
2. In Gladys, install the BleBox integration from the store.
3. Type the IP addresses of the modules (separated by commas), or use "Find
   the BleBox devices" (mDNS search through Gladys).
4. Add the devices from the Discovery tab.

If the local API of your modules is protected in the wBox app, type the user
name and the password. The password is kept by Gladys in its database, never
shown again, sent only to your modules: the typed addresses and the modules
already added (in clear on your local network: the modules have no https). A
protected module only found by the search gets no credentials: the status
asks you to type its address.

## Command safety

- **Relays**: a relay may feed anything, and a "turn everything off" of a
  voice assistant or a scene reaches every switch. So a relay is shown read
  only until you declare it safe in "Relays declared safe" (the module id,
  parameter `DEVICE_ID` of the Discovery tab, or `id:number` for one relay).
  A relay removed from the list is refused at once, even if its command was
  waiting.
- **Gate**: never a switch, only buttons, and only the ones the wiring of the
  gateBox allows. Opening (and the walk-in output) is refused until "Allow
  opening the gate" is on.
  - Recent gateBox (API 20210118 or later): opening and closing use its
    `/s/o` and `/s/c` commands, the module decides on its limit switches
    (and refuses when it cannot tell). Closing is always allowed. These
    commands depend on the limit switches: check in the wBox app that the
    open/closed state the gateBox shows is right before relying on them.
  - Opening and closing on separate outputs: closing is always allowed.
  - Step-by-step mode on an older gateBox: closing and opening are **the
    same pulse** (open, stop, close, stop). So closing also needs "Allow
    opening the gate", and the pulse is only sent when the gate is seen
    fully open to close it, or fully closed to open it.
  - Stopping (second output set as "stop") is always allowed.
  - One pulse at a time: after a pulse, the next one is refused until the
    gate is seen elsewhere than where it was (or a few seconds later); use
    "Stop the gate". Recent gateBox modules do not tell whether the gate
    moves, only whether it is at a limit switch.
  - Closing and stopping cancel, as soon as they arrive, an opening (or a
    walk-in output) that has not left yet; cancelling never sends anything.
    The walk-in output follows the same one-pulse-at-a-time rule.
- **Heating (thermoBox)**: switching off is always sent, without a state
  read (it only depends on the identity of the module). Switching on and the
  setpoint are refused until "Allow the heating commands" is on, and the
  setpoint never exceeds the ceiling (25 °C by default, 30 °C at most) nor
  the range of the thermoBox. Gladys only switches the thermoBox on in the
  mode (heating or cooling) set in its own settings.
- Before every command, Gladys checks that the same module still answers at
  this address. Each sensitive command reads the state of the module just
  before acting; the permission is checked again right before sending. A
  command that cannot leave within 3.5 seconds is refused unsent; a command
  sent without an answer is reported "sent, without confirmation".

## Failures

- Credentials refused: the module is no longer asked nor commanded, then
  again after 15 min, 1 h, 6 h and every 24 h; saving other credentials or
  "Find the BleBox devices" tries again at once.
- A module asking to wait (HTTP 429 or 5xx) is paused for one minute to six
  hours, even across a restart: no reads, no opening, no switching on.
  Closing, stopping and switching off stay possible (one try).
- A module that does not answer is read again after 30 s, 1, 2 then 5 min,
  never faster than the refresh interval; if its address changed, an mDNS
  search finds it again (every 5 minutes at most).

## Limits

- No energy index (kWh counters) in this version, nor the PM1 of the
  airSensor, the slat tilt, the white temperature or the effects of the
  wLightBox.
- No saunaBox, tvLiftBox nor gateController.
