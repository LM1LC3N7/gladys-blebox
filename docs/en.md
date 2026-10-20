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
shown again, sent only to your modules (in clear on your local network: the
modules have no https).

## Command safety

- **Relays**: a relay may feed anything, and a "turn everything off" of a
  voice assistant or a scene reaches every switch. So a relay is shown read
  only until you declare it safe in "Relays declared safe" (the module id,
  parameter `DEVICE_ID` of the Discovery tab, or `id:number` for one relay).
- **Gate**: never a switch, only buttons. Closing and stopping are always
  allowed and cancel an opening that has not left yet. Opening (and the
  walk-in output) is refused until "Allow opening the gate" is on. In
  step-by-step mode, the pulse is only sent when the gate is seen fully
  closed to open it, or fully open to close it: otherwise, use "Stop the
  gate".
- **Heating (thermoBox)**: switching off is always allowed. Switching on and
  the setpoint are refused until "Allow the heating commands" is on, and the
  setpoint never exceeds the ceiling (25 °C by default, 30 °C at most) nor
  the range of the thermoBox. Gladys only switches the thermoBox on in the
  mode (heating or cooling) set in its own settings.
- Each sensitive command reads the state of the module just before acting
  and checks that the same module still answers at this address; the
  permission is checked again right before sending. A command that cannot
  leave within 3.5 seconds is refused unsent; a command sent without an
  answer is reported "sent, without confirmation".

## Failures

- Credentials refused: the module is no longer asked, then again after
  15 min, 1 h, 6 h and every 24 h; saving other credentials or "Find the
  BleBox devices" tries again at once.
- A module asking to wait (HTTP 429 or 5xx) is paused for one minute to six
  hours, even across a restart.
- A module that does not answer is read again after 30 s, 1, 2 then 5 min,
  never faster than the refresh interval.

## Limits

- No energy index (kWh counters) in this version, nor the PM1 of the
  airSensor, the slat tilt, the white temperature or the effects of the
  wLightBox.
- No saunaBox, tvLiftBox nor gateController.
