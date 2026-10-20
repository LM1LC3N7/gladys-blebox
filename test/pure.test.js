// -----------------------------------------------------------------------------
// The pure parts: configuration, identities, layouts and readings (fixtures of
// blebox-uniapi), light channels, the /data file.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseAddress, parseSafeRelays } from '../src/config.js';
import { THERMO_LIMITS, TIMINGS } from '../src/constants.js';
import { bytesOf, commandHex, readUnit, unitsOf } from '../src/blebox/light.js';
import { layoutOf, mergeLayout, readingOf } from '../src/blebox/parse.js';
import { configOf, parseIdentity } from '../src/blebox/types.js';
import { featuresOf, valuesOf } from '../src/model.js';
import { sanitize } from '../src/store.js';

test('config: addresses, safe relays, options strictly true, the heating ceiling', () => {
  assert.equal(parseAddress('http://192.168.1.40/api/device/state'), '192.168.1.40');
  assert.equal(parseAddress('192.168.1.40:8080'), '192.168.1.40:8080');
  assert.equal(parseAddress('user:pass@192.168.1.40'), undefined);
  assert.equal(parseAddress('999.1.1.1'), undefined);
  const { safe, invalid } = parseSafeRelays('1AFE34E750B8, aa0000000001:1 nope');
  assert.deepEqual([...safe], ['1afe34e750b8', 'aa0000000001:1']);
  assert.deepEqual(invalid, ['nope']);
  const config = normalizeConfig({
    addresses: '192.168.1.40, admin:x@10.0.0.1',
    allow_gate_open: 'yes',
    allow_heating: 1,
    heating_max_temperature: 95,
  });
  assert.deepEqual(config.addresses, ['192.168.1.40']);
  assert.deepEqual(config.invalidAddresses, ['…@10.0.0.1'], 'never what precedes an @');
  assert.equal(config.allowGateOpen, false);
  assert.equal(config.allowHeating, false);
  assert.equal(config.heatingCap, THERMO_LIMITS.hardMax);
  assert.equal(normalizeConfig({ heating_max_temperature: '' }).heatingCap, 25);
  assert.equal(normalizeConfig({ password: 'x' }).credentialsProblem, 'passwordWithoutUser');
  assert.equal(normalizeConfig({ poll_interval: 1 }).pollInterval, 5);
});

test('identity: id, type, API level, wLightBoxS behind a wLightBox', () => {
  const identity = parseIdentity({
    deviceName: 'My gate 1',
    type: 'gateBox',
    fv: '0.176',
    hv: '0.6',
    id: '1AFE34DB9437',
  });
  assert.equal(identity.id, '1afe34db9437');
  assert.equal(identity.apiLevel, 20151206);
  assert.equal(configOf('gateBox', identity.apiLevel).state, '/api/gate/state');
  assert.equal(configOf('gateBox', 20230102).state, '/state/extended');
  assert.equal(
    parseIdentity({
      type: 'wLightBox',
      product: 'wLightBoxS',
      id: 'aabbccddeeff',
      apiLevel: '20200229',
    }).type,
    'wLightBoxS',
  );
  assert.deepEqual(parseIdentity({ type: 'saunaBox', id: 'aabbccddeeff' }), {
    error: 'unsupported',
    type: 'saunaBox',
  });
  assert.equal(
    parseIdentity({ type: 'shutterBox', id: 'aabbccddeeff', apiLevel: '20180603' }).error,
    'version',
  );
  assert.equal(parseIdentity({ type: 'gateBox', id: '../../x' }).error, 'invalid');
  assert.equal(
    parseIdentity({ type: 'gateBox', id: 'aabbccddeeff', apiLevel: 'x' }).error,
    'invalid',
  );
});

test('switchBox: relays of the oldest API (an array) and of the extended state', () => {
  assert.deepEqual(layoutOf('switch', [{ relay: 0, state: 1 }]).relays, [{ index: 0, name: '' }]);
  const data = {
    relays: [
      { relay: 0, state: 1, name: 'output 1' },
      { relay: 1, state: 0, name: 'output 2' },
    ],
    sensors: [{ type: 'activePower', value: 12.34, state: 2 }],
  };
  const layout = layoutOf('switch', data);
  assert.equal(layout.relays.length, 2);
  assert.equal(layout.power, true);
  assert.deepEqual(readingOf('switch', data, layout), { relays: { 0: 1, 1: 0 }, power: 12.3 });
  // A relay missing from one answer never removes a feature.
  const merged = mergeLayout('switch', layout, layoutOf('switch', { relays: [{ relay: 0 }] }));
  assert.equal(merged.relays.length, 2);
});

test('gate: legacy and extended answers, unknown position (-1) left out', () => {
  const legacy = { currentPos: 50, desiredPos: 100, extraButtonType: 1, gateType: 0 };
  assert.deepEqual(readingOf('gate', legacy, layoutOf('gate', legacy)), {
    position: 50,
    mode: undefined,
    extra: 1,
    moving: true,
  });
  const extended = { gate: { currentPos: -1, openCloseMode: 2, extraButtonType: 2 } };
  const layout = layoutOf('gate', extended);
  assert.equal(layout.secondOutput, false, 'open/close mode: the second output closes');
  assert.equal(readingOf('gate', extended, layout).position, undefined);
  const walkIn = { gate: { currentPos: 0, openCloseMode: 0, extraButtonType: 2 } };
  assert.equal(layoutOf('gate', walkIn).secondOutput, true);
  const record = { id: 'aa0000000001', kind: 'gate', layout: layoutOf('gate', walkIn) };
  const keys = featuresOf(record).map((f) => f.key);
  assert.deepEqual(keys, ['gate', 'position', 'open', 'close', 'stop', 'second-output']);
  assert.ok(featuresOf(record).every((f) => f.spec.category !== 'switch'));
});

test('thermoBox: room sensor apart from the safety one, errors left out', () => {
  const data = {
    thermo: {
      state: 4,
      operatingState: 1,
      desiredTemp: -70,
      mode: 2,
      minimumTemp: -1230,
      maximumTemp: 6000,
      safetyTempSensor: { sensorId: 0 },
    },
    sensors: [
      { id: 0, type: 'temperature', value: 2098, state: 2 },
      { id: 1, type: 'temperature', value: 18349, state: 3 },
    ],
  };
  const layout = layoutOf('thermo', data);
  assert.deepEqual(layout, { main: 1, probes: [0] });
  const reading = readingOf('thermo', data, layout);
  assert.equal(reading.safetyOff, true);
  assert.equal(reading.on, false);
  assert.equal(reading.desired, -0.7);
  assert.deepEqual(reading.temperatures, { 0: 21 }, 'the sensor in error is left out');
  const values = valuesOf({ id: 'bb0000000002', kind: 'thermo', layout }, reading);
  assert.equal(values.has('temperature'), false);
  assert.equal(values.get('probe-0'), 21);
  assert.equal(values.get('safety'), 1);
  assert.equal(values.get('mode'), 0);
  assert.equal(values.get('operating-state'), 1);
});

test('sensors: tempSensor, airSensor, multiSensor scales', () => {
  const temp = { tempSensor: { sensors: [{ id: 0, value: 2512, state: 2, trend: 0 }] } };
  assert.equal(readingOf('tempSensor', temp, {}).temperature, 25.1);
  const initializing = { tempSensor: { sensors: [{ id: 0, value: 2512, state: 1 }] } };
  assert.equal(readingOf('tempSensor', initializing, {}).temperature, undefined);
  const multi = {
    multiSensor: {
      sensors: [
        { id: 0, type: 'temperature', value: 2150, state: 2 },
        { id: 1, type: 'humidity', value: 4567, state: 2 },
        { id: 2, type: 'wind', value: 35, state: 2 },
        { id: 3, type: 'rain', value: 1, state: 2 },
        { id: 4, type: 'forwardActiveEnergy', value: 12345, state: 2 },
        { id: 5, type: '__proto__', value: 1, state: 2 },
      ],
    },
  };
  const layout = layoutOf('multi', multi);
  assert.deepEqual(
    layout.sensors.map((s) => `${s.type}-${s.id}`),
    ['temperature-0', 'humidity-1', 'wind-2', 'rain-3'],
    'no energy index (never 0 nor a jump to Gladys without the guard), no odd type',
  );
  assert.deepEqual(readingOf('multi', multi, layout).values, {
    'temperature-0': 21.5,
    'humidity-1': 45.7,
    'wind-2': 3.5,
    'rain-3': 1,
  });
});

test('a hostile answer: prototype keys are never followed, odd values left out', () => {
  const hostile = JSON.parse(
    '{"__proto__": {"polluted": 1}, "relays": [{"relay": "0", "state": 1}, {"relay": 1, "state": 7}]}',
  );
  assert.deepEqual(readingOf('switch', hostile, layoutOf('switch', hostile)).relays, {});
  assert.equal({}.polluted, undefined);
  assert.deepEqual(readingOf('gate', null, {}).position, undefined);
  assert.deepEqual(readingOf('thermo', 'text', {}).temperatures, {});
});

test('lights: channels by colour mode, masked commands', () => {
  assert.deepEqual(bytesOf('ff8000'), [255, 128, 0]);
  assert.equal(bytesOf('ff800'), undefined);
  assert.equal(bytesOf('zz'), undefined);
  const mono = unitsOf({ kind: 'light', mode: 3, channels: 4 });
  assert.deepEqual(
    mono.map((u) => [u.key, u.bytes]),
    [
      ['-1', [0]],
      ['-2', [1]],
      ['-3', [2]],
      ['-4', [3]],
    ],
  );
  assert.equal(commandHex(mono[1], [10, 0, 30, 40], undefined, 'brightness', 100).hex, '--ff----');
  const [rgbw] = unitsOf({ kind: 'light', mode: 1, channels: 4 });
  assert.deepEqual(readUnit(rgbw, [0, 0, 0, 0], 2), { on: 1, brightness: 0 }, 'an effect is on');
  assert.equal(commandHex(rgbw, [0, 0, 0, 0], [0, 0, 255, 0], 'light', 1).hex, '0000ff00');
  assert.equal(commandHex(rgbw, [0, 0, 0, 0], undefined, 'light', 1).hex, 'ffffffff');
  assert.deepEqual(commandHex(rgbw, [0, 0, 0, 0], undefined, 'light', 0), { unchanged: true });
  const ctx2 = unitsOf({ kind: 'light', mode: 6, channels: 5 });
  assert.equal(
    commandHex(ctx2[1], [1, 2, 200, 100, 0], undefined, 'brightness', 50).hex,
    '----8040--',
  );
  const [dimmer] = unitsOf({ kind: 'dimmer', channels: 1 });
  assert.deepEqual(commandHex(dimmer, [0], undefined, 'light', 1).bytes, [255]);
});

test('/data: unknown keys dropped, a block never longer than its bound', () => {
  const now = 1_000_000;
  const data = sanitize(
    {
      devices: { aa0000000001: { id: 'aa0000000001' }, 'not-an-id': { id: 'not-an-id' } },
      blocks: {
        '192.168.1.40': { kind: 'pause', until: now + 365 * 86_400_000, failures: 3 },
        '192.168.1.41': { kind: 'auth', until: 'soon' },
        '192.168.1.42': { kind: 'other', until: now + 1 },
      },
      extra: 'dropped',
    },
    now,
  );
  assert.deepEqual(Object.keys(data.devices), ['aa0000000001']);
  assert.equal(data.blocks['192.168.1.40'].until, now + TIMINGS.pauseMax);
  assert.equal(data.blocks['192.168.1.41'].until, now);
  assert.equal(data.blocks['192.168.1.42'], undefined);
  assert.equal(data.extra, undefined);
});
