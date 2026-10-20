// -----------------------------------------------------------------------------
// Fake BleBox devices behind the `request` of BleBoxClient (src/blebox/http.js
// replaced): answers taken from the fixtures of blebox-uniapi, a log of every
// call, and hooks to make a request slow, fail or answer late. No network.
// -----------------------------------------------------------------------------

import { BleBoxError } from '../../src/blebox/errors.js';

export const IDS = {
  switch: '1afe34e750b8',
  gate: 'aa0000000001',
  thermo: 'bb0000000002',
  shutter: 'cc0000000003',
  light: 'dd0000000004',
  air: 'ee0000000005',
  oldGate: 'aa0000000006',
};

const info = (id, type, apiLevel, deviceName) => ({
  device: { deviceName, type, product: type, fv: '0.1', hv: '0.1', apiLevel, id, ip: 'x' },
});

/** The state of each fake device, changed by its commands. */
export function devices() {
  const relays = [
    { relay: 0, state: 0, name: 'Lamp' },
    { relay: 1, state: 1, name: 'Pump' },
  ];
  const gate = {
    currentPos: 0,
    openCloseMode: 0,
    gateType: 0,
    extraButtonType: 1,
  };
  const oldGate = { currentPos: 100, gateType: 0, extraButtonType: 1, gatePulseTimeMs: 1500 };
  const thermo = {
    state: 0,
    operatingState: 3,
    desiredTemp: 2000,
    mode: 1,
    minimumTemp: 500,
    maximumTemp: 3500,
    safetyTempSensor: { sensorId: 1 },
  };
  const thermoSensors = [
    { id: 0, type: 'temperature', value: 2098, state: 2 },
    { id: 1, type: 'temperature', value: 2775, state: 2 },
  ];
  const shutter = {
    state: 2,
    currentPos: { position: 30, tilt: 0 },
    desiredPos: { position: 30, tilt: 0 },
  };
  const rgbw = { colorMode: 1, desiredColor: 'ff000000', lastOnColor: 'ff000000', effectID: 0 };
  const relayState = () => ({
    relays,
    sensors: [{ type: 'activePower', id: 0, value: 42.5, state: 2 }],
  });
  return {
    '192.168.1.40': {
      routes: {
        'GET /api/device/state': info(IDS.switch, 'switchBoxD', '20200831', 'Relays'),
        'GET /state/extended': relayState,
        'GET /s/0/1': () => ((relays[0].state = 1), relayState()),
        'GET /s/0/0': () => ((relays[0].state = 0), relayState()),
        'GET /s/1/0': () => ((relays[1].state = 0), relayState()),
      },
    },
    '192.168.1.41': {
      gate,
      routes: {
        'GET /api/device/state': info(IDS.gate, 'gateBox', '20230102', 'Gate'),
        'GET /state/extended': () => ({ gate }),
        'GET /s/o': () => ({ gate }),
        'GET /s/c': () => ({ gate }),
        'GET /s/s': () => ({ gate }),
      },
    },
    // An older gateBox (no /s/o, /s/c, no openCloseMode): step-by-step pulses.
    '192.168.1.46': {
      gate: oldGate,
      routes: {
        'GET /api/device/state': info(IDS.oldGate, 'gateBox', '20200831', 'Old gate'),
        'GET /state/extended': () => ({ gate: oldGate }),
        'GET /s/p': () => ({ gate: oldGate }),
        'GET /s/s': () => ({ gate: oldGate }),
      },
    },
    '192.168.1.42': {
      thermo,
      routes: {
        'GET /api/device/state': info(IDS.thermo, 'thermoBox', '20200229', 'Floor'),
        'GET /state/extended': () => ({ thermo, sensors: thermoSensors }),
        'GET /s/1': () => ((thermo.state = 1), { thermo }),
        'GET /s/0': () => ((thermo.state = 0), { thermo }),
        'GET /s/t/2100': () => ((thermo.desiredTemp = 2100), { thermo }),
      },
    },
    '192.168.1.43': {
      shutter,
      routes: {
        'GET /api/device/state': info(IDS.shutter, 'shutterBox', '20180604', 'Kitchen'),
        'GET /api/shutter/state': () => ({ shutter }),
        'GET /api/shutter/extended/state': () => ({
          shutter: { ...shutter, controlType: 1, calibrationParameters: { isCalibrated: 1 } },
        }),
        'GET /s/u': () => ({ shutter }),
        'GET /s/d': () => ({ shutter }),
        'GET /s/s': () => ({ shutter }),
        'GET /s/p/50': () => ({ shutter }),
      },
    },
    '192.168.1.44': {
      rgbw,
      routes: {
        'GET /api/device/state': info(IDS.light, 'wLightBox', '20200229', 'Strip'),
        'GET /api/rgbw/state': () => ({ rgbw }),
        'GET /api/rgbw/extended/state': () => ({ rgbw }),
        'POST /api/rgbw/set': ({ body }) => {
          const asked = JSON.parse(body).rgbw.desiredColor;
          rgbw.desiredColor = [...rgbw.desiredColor.match(/../g)]
            .map((pair, i) =>
              asked.slice(i * 2, i * 2 + 2) === '--' ? pair : asked.slice(i * 2, i * 2 + 2),
            )
            .join('');
          return { rgbw };
        },
      },
    },
    '192.168.1.45': {
      routes: {
        'GET /api/device/state': info(IDS.air, 'airSensor', '20180403', 'Air'),
        'GET /api/air/state': {
          air: {
            sensors: [
              { type: 'pm1', value: 3, state: 2 },
              { type: 'pm2.5', value: 12, state: 2 },
              { type: 'pm10', value: 20, state: 2 },
            ],
          },
        },
      },
    },
  };
}

/**
 * The `request` of BleBoxClient over the fake devices.
 * - `hold(address, path)`: the next request to it waits for `release()`;
 * - `fail(address, path, error | { status, headers })`: the next one fails;
 * - `auth`: the credentials every device wants, if any.
 */
export function fakeNetwork(table = devices(), { auth } = {}) {
  const calls = [];
  const holds = [];
  const failures = [];
  const request = async (options) => {
    const { method, host, port, path, headers, body, beforeSend } = options;
    const address = port === 80 ? host : `${host}:${port}`;
    const hold = holds.find((h) => h.address === address && h.path === path && !h.used);
    if (hold) {
      hold.used = true;
      await hold.promise;
    }
    const device = table[address];
    if (!device) {
      throw new BleBoxError('unreachable');
    }
    const early = failures.find(
      (f) => f.address === address && f.path === path && !f.used && f.before,
    );
    if (early) {
      // Never connected: nothing left.
      early.used = true;
      throw early.error;
    }
    // Connected: the last check of a command, then the request leaves.
    if (beforeSend) {
      try {
        beforeSend();
      } catch (err) {
        err.beforeSend = true;
        err.sent = false;
        throw err;
      }
    }
    calls.push({ method, address, path, headers, body });
    const failure = failures.find(
      (f) => f.address === address && f.path === path && !f.used && !f.before,
    );
    if (failure) {
      failure.used = true;
      if (failure.error) {
        throw failure.error;
      }
      return { status: failure.status, headers: failure.headers ?? {}, body: Buffer.alloc(0) };
    }
    if (auth) {
      const expected = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
      if (headers.authorization !== expected) {
        return { status: 401, headers: {}, body: Buffer.alloc(0) };
      }
    }
    const route = device.routes[`${method} ${path}`];
    if (route === undefined) {
      return { status: 404, headers: {}, body: Buffer.from('not found') };
    }
    const answer = typeof route === 'function' ? route({ body }) : route;
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(answer)) };
  };
  return {
    request,
    calls,
    table,
    hold(address, path) {
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      holds.push({ address, path, promise });
      return release;
    },
    fail(address, path, failure, { before = false } = {}) {
      failures.push({
        address,
        path,
        before,
        ...(failure instanceof Error ? { error: failure } : failure),
      });
    },
    commands: () => calls.filter((c) => /^\/s\//.test(c.path) || c.method === 'POST'),
  };
}
