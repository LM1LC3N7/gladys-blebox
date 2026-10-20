// -----------------------------------------------------------------------------
// BleBoxApp with the SDK's fake Gladys, the exact handlers of the container
// (src/handlers.js), fake devices behind the client's `request`, a memory
// store. No network, no timers running.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { BleBoxApp } from '../src/app.js';
import { BleBoxClient } from '../src/blebox/client.js';
import { BleBoxError } from '../src/blebox/errors.js';
import { normalizeConfig } from '../src/config.js';
import { registerHandlers } from '../src/handlers.js';
import { MemoryStore } from '../src/store.js';
import { IDS, fakeNetwork } from './helpers/fakeBlebox.js';

const SELECTOR = 'blebox';
const id = (deviceId, key) => `ext:${SELECTOR}:blebox:${deviceId}${key ? `:${key}` : ''}`;
const ALL = '192.168.1.40, 192.168.1.41, 192.168.1.42, 192.168.1.43, 192.168.1.44, 192.168.1.45';

/** Timers that never fire: the tests drive the polling and the flushes. */
const timers = {
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: () => 1,
  clearTimeout: () => {},
};

async function setup(
  t,
  {
    config = {},
    net = fakeNetwork(),
    store = new MemoryStore(),
    devices = [],
    scanResults = {},
  } = {},
) {
  const fullConfig = { addresses: ALL, ...config };
  const gladys = createFakeGladys({ selector: SELECTOR, config: fullConfig, devices, scanResults });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.message ?? a).join(' ')}`),
    ]),
  );
  const app = new BleBoxApp({
    gladys,
    logger,
    client: new BleBoxClient({ request: net.request }),
    store,
    timers,
  });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop());
  return { gladys, app, net, logs, store };
}

async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
}

const deviceOf = (gladys, deviceId) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === id(deviceId));
const featureOf = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));

async function press(gladys, deviceId, key, value = 1) {
  const device = deviceOf(gladys, deviceId);
  return gladys.fake.setValue(device, featureOf(device, key), value);
}

test('the typed addresses become the devices of the Discovery tab', async (t) => {
  const { gladys } = await setup(t);
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(devices.map((d) => d.name).sort(), [
    'Air',
    'Floor',
    'Gate',
    'Kitchen',
    'Relays',
    'Strip',
  ]);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /6 of 6 BleBox device\(s\) answer/);
  assert.match(gladys.fake.connectionStatus.message.fr, /6 appareil\(s\) BleBox sur 6/);
});

test('a relay not declared safe is read only; a gate and a heating are never a switch', async (t) => {
  const { gladys } = await setup(t);
  const relays = deviceOf(gladys, IDS.switch);
  assert.deepEqual(
    relays.features.map((f) => [f.external_id.split(':').at(-1), f.category, f.read_only]),
    [
      ['relay-0-state', 'unknown', true],
      ['relay-1-state', 'unknown', true],
      ['power', 'switch', true],
    ],
  );
  for (const deviceId of [IDS.gate, IDS.thermo]) {
    for (const feature of deviceOf(gladys, deviceId).features) {
      assert.notEqual(feature.category, 'switch', feature.external_id);
      assert.ok(
        feature.read_only || feature.type !== 'binary',
        `${feature.external_id} is a commandable binary`,
      );
    }
  }
  const gate = deviceOf(gladys, IDS.gate);
  assert.deepEqual(
    gate.features
      .filter((f) => !f.read_only)
      .map((f) => [f.external_id.split(':').at(-1), f.category, f.type]),
    [
      ['open', 'button', 'push'],
      ['close', 'button', 'push'],
      ['stop', 'button', 'push'],
    ],
  );
});

test('states: only for the created devices, a created device gets the last values', async (t) => {
  const { gladys, app } = await setup(t);
  await app.publisher.flush();
  assert.equal(gladys.fake.states.length, 0);
  await createAll(gladys);
  await app.publisher.flush();
  const last = (deviceId, key) => gladys.fake.lastState(id(deviceId, key));
  assert.equal(last(IDS.switch, 'relay-1-state'), 1);
  assert.equal(last(IDS.switch, 'power'), 42.5);
  assert.equal(last(IDS.gate, 'gate'), 1, 'closed');
  assert.equal(last(IDS.gate, 'position'), 0);
  assert.equal(last(IDS.thermo, 'temperature'), 21);
  assert.equal(last(IDS.thermo, 'probe-1'), 27.8);
  assert.equal(last(IDS.thermo, 'target'), 20);
  assert.equal(last(IDS.thermo, 'mode'), 0);
  assert.equal(last(IDS.shutter, 'position'), 70);
  assert.equal(last(IDS.light, 'light'), 1);
  assert.equal(last(IDS.light, 'brightness'), 100);
  assert.equal(last(IDS.light, 'color'), 0xff0000);
  assert.equal(last(IDS.air, 'pm25'), 12);
  assert.equal(last(IDS.air, 'pm10'), 20);
});

test('relays: only a relay declared safe is a switch and is commanded', async (t) => {
  const { gladys, net } = await setup(t, { config: { safe_relays: `${IDS.switch}:0` } });
  const relays = deviceOf(gladys, IDS.switch);
  assert.equal(featureOf(relays, 'relay-0').category, 'switch');
  assert.ok(featureOf(relays, 'relay-1-state').read_only);
  const ack = await press(gladys, IDS.switch, 'relay-0', 1);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    net.commands().map((c) => c.path),
    ['/s/0/1'],
  );
  const refused = await gladys.fake.setValue(relays, featureOf(relays, 'relay-1-state'), 0);
  assert.equal(refused.success, false);
  assert.equal(net.commands().length, 1);
});

test('a relay no longer declared safe keeps its feature but refuses the commands', async (t) => {
  const { gladys, net } = await setup(t, { config: { safe_relays: IDS.switch } });
  await createAll(gladys);
  await gladys.fake.configUpdated({ addresses: ALL, safe_relays: '' });
  const relays = deviceOf(gladys, IDS.switch);
  const keys = relays.features.map((f) => f.external_id.split(':').at(-1));
  assert.ok(keys.includes('relay-0'), 'the created feature is kept');
  assert.ok(keys.includes('relay-0-state'));
  const ack = await gladys.fake.setValue(relays, featureOf(relays, 'relay-0'), 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /pas déclaré sûr/);
  assert.equal(net.commands().length, 0);
});

const OLD = '192.168.1.46';
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

test('gate: opening is refused by default, nothing sent', async (t) => {
  const { gladys, net } = await setup(t);
  const ack = await press(gladys, IDS.gate, 'open');
  assert.equal(ack.success, false);
  assert.match(ack.error, /désactivée dans la configuration/);
  assert.equal(net.commands().length, 0);
});

test('gate API >= 20210118: /s/o behind the option, /s/c always, the module decides (409)', async (t) => {
  const { gladys, net } = await setup(t, { config: { allow_gate_open: true } });
  const before = net.calls.length;
  const ack = await press(gladys, IDS.gate, 'open');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    net.calls.slice(before).map((c) => c.path),
    ['/api/device/state', '/state/extended', '/s/o'],
    'identity, state, then the device-side opening',
  );
  net.table['192.168.1.41'].gate.currentPos = 50;
  await gladys.fake.configUpdated({ addresses: ALL, allow_gate_open: false });
  // Closing never needs the option: /s/c never opens.
  assert.equal((await press(gladys, IDS.gate, 'close')).success, true);
  assert.equal(net.commands().at(-1).path, '/s/c');
  net.fail('192.168.1.41', '/s/c', { status: 409 });
  net.table['192.168.1.41'].gate.currentPos = 100;
  const unsure = await press(gladys, IDS.gate, 'close');
  assert.equal(unsure.success, false);
  assert.match(unsure.error, /ni complètement ouvert ni complètement fermé/);
  assert.equal((await press(gladys, IDS.gate, 'stop')).success, true);
  assert.equal(net.commands().at(-1).path, '/s/s');
  assert.ok(!net.commands().some((c) => c.path === '/s/p'), 'never the toggle');
});

test('B1: step-by-step, closing is the opening pulse: refused without the option', async (t) => {
  const { gladys, net } = await setup(t, { config: { addresses: OLD } });
  const ack = await press(gladys, IDS.oldGate, 'close');
  assert.equal(ack.success, false);
  assert.match(ack.error, /même impulsion qu'ouvrir/);
  assert.equal(net.commands().length, 0);
  // Stop stays allowed (the second output is a stop, read just now).
  assert.equal((await press(gladys, IDS.oldGate, 'stop')).success, true);
  assert.deepEqual(
    net.commands().map((c) => c.path),
    ['/s/s'],
  );
});

test('step-by-step, allowed: a pulse only from a gate seen fully open (close) or closed (open)', async (t) => {
  const { gladys, net } = await setup(t, { config: { addresses: OLD, allow_gate_open: true } });
  assert.equal((await press(gladys, IDS.oldGate, 'close')).success, true);
  assert.deepEqual(
    net.commands().map((c) => c.path),
    ['/s/p'],
  );
  net.table[OLD].gate.currentPos = 50;
  const ajar = await press(gladys, IDS.oldGate, 'close');
  assert.equal(ajar.success, false);
  assert.match(ajar.error, /Arrêter le portail/);
  const notClosed = await press(gladys, IDS.oldGate, 'open');
  assert.match(notClosed.error, /pas vu fermé/);
  net.table[OLD].gate.currentPos = 0;
  assert.equal((await press(gladys, IDS.oldGate, 'open')).success, true);
  assert.equal(net.commands().length, 2);
});

test('I1: one gate pulse at a time, and none until the gate is seen moving', async (t) => {
  const { gladys, net } = await setup(t, { config: { addresses: OLD, allow_gate_open: true } });
  // Two closes at once from 100 %: one pulse, the other refused.
  const acks = await Promise.all([
    press(gladys, IDS.oldGate, 'close'),
    press(gladys, IDS.oldGate, 'close'),
  ]);
  assert.deepEqual(acks.map((a) => a.success).sort(), [false, true]);
  assert.equal(net.commands().length, 1);
  // The limit switch still reads 100: a second pulse would stop it.
  const again = await press(gladys, IDS.oldGate, 'close');
  assert.equal(again.success, false);
  assert.match(again.error, /vient d'être commandé/);
  // Seen moving (50): the guard is lifted, the stop is always there.
  net.table[OLD].gate.currentPos = 50;
  assert.match((await press(gladys, IDS.oldGate, 'close')).error, /pas vu complètement ouvert/);
  assert.equal((await press(gladys, IDS.oldGate, 'stop')).success, true);
  assert.equal(net.commands().length, 2);
});

test('I1c: two openings in a row from a closed gate: one pulse only', async (t) => {
  const { gladys, net } = await setup(t, { config: { addresses: OLD, allow_gate_open: true } });
  net.table[OLD].gate.currentPos = 0;
  assert.equal((await press(gladys, IDS.oldGate, 'open')).success, true);
  const second = await press(gladys, IDS.oldGate, 'open');
  assert.equal(second.success, false, 'a second pulse would stop it ajar');
  assert.equal(net.commands().length, 1);
});

test('gate: a close cancels an opening still waiting to leave', async (t) => {
  const { gladys, net } = await setup(t, { config: { allow_gate_open: true } });
  net.table['192.168.1.41'].gate.currentPos = 50;
  const release = net.hold('192.168.1.41', '/state/extended');
  const opening = press(gladys, IDS.gate, 'open');
  await tick();
  const closing = await press(gladys, IDS.gate, 'close');
  assert.equal(closing.success, true, closing.error);
  release();
  const opened = await opening;
  assert.equal(opened.success, false);
  assert.match(opened.error, /Annulée/);
  assert.deepEqual(
    net.commands().map((c) => c.path),
    ['/s/c'],
    'never /s/o',
  );
});

test('gate: the option switched off during the read refuses the opening (beforeSend)', async (t) => {
  const { gladys, app, net } = await setup(t, { config: { allow_gate_open: true } });
  const release = net.hold('192.168.1.41', '/s/o');
  const opening = press(gladys, IDS.gate, 'open');
  await tick();
  app.config = normalizeConfig({ addresses: ALL, allow_gate_open: false });
  release();
  const ack = await opening;
  assert.equal(ack.success, false);
  assert.match(ack.error, /désactivée/);
  assert.equal(net.commands().length, 0);
});

test('gate: another device at the address is never commanded', async (t) => {
  const { gladys, net } = await setup(t);
  net.table['192.168.1.41'].routes['GET /api/device/state'] = {
    device: { deviceName: 'Other', type: 'gateBox', apiLevel: '20230102', id: 'ff00000000ff' },
  };
  net.table['192.168.1.41'].gate.currentPos = 100;
  const ack = await press(gladys, IDS.gate, 'close');
  assert.equal(ack.success, false);
  assert.match(ack.error, /plus à son adresse/);
  assert.equal(net.commands().length, 0);
});

test('gate: a request that may have left is "sent, without confirmation"', async (t) => {
  const { gladys, net } = await setup(t);
  net.table['192.168.1.41'].gate.currentPos = 100;
  net.fail('192.168.1.41', '/s/c', new BleBoxError('timeout', { sent: true }));
  const ack = await press(gladys, IDS.gate, 'close');
  assert.equal(ack.success, false);
  assert.match(ack.error, /envoyée, sans confirmation \(timeout\)/);
  // Guarded since: the gate has not been seen moving.
  assert.match((await press(gladys, IDS.gate, 'close')).error, /vient d'être commandé/);
});

test('gate: a request that could not connect is "not sent"', async (t) => {
  const { gladys, net } = await setup(t);
  net.table['192.168.1.41'].gate.currentPos = 100;
  net.fail('192.168.1.41', '/s/c', new BleBoxError('unreachable'), { before: true });
  const unsent = await press(gladys, IDS.gate, 'close');
  assert.match(unsent.error, /Commande non envoyée/);
});

test('M1: only the buttons the wiring can do; the walk-in output without openCloseMode', async (t) => {
  const net = fakeNetwork();
  net.table[OLD].gate.extraButtonType = 2;
  net.table['192.168.1.41'].gate.openCloseMode = 2;
  const { gladys } = await setup(t, {
    net,
    config: { addresses: `192.168.1.41, ${OLD}`, allow_gate_open: true },
  });
  const keys = (deviceId) =>
    deviceOf(gladys, deviceId)
      .features.filter((f) => !f.read_only)
      .map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys(IDS.gate), ['open', 'close'], 'open/close mode: no stop');
  assert.deepEqual(keys(IDS.oldGate), ['open', 'close', 'second-output']);
  assert.equal((await press(gladys, IDS.oldGate, 'second-output')).success, true);
  assert.equal(net.commands().at(-1).path, '/s/s');
});

test('thermoBox: setpoint and switching on need the option, switching off never', async (t) => {
  const { gladys, net } = await setup(t);
  const refused = await press(gladys, IDS.thermo, 'target', 21);
  assert.equal(refused.success, false);
  assert.match(refused.error, /chauffage sont désactivées/);
  assert.equal((await press(gladys, IDS.thermo, 'mode', 1)).success, false);
  assert.equal(net.commands().length, 0);
  net.table['192.168.1.42'].thermo.state = 1;
  assert.equal((await press(gladys, IDS.thermo, 'mode', 0)).success, true);
  assert.deepEqual(
    net.commands().map((c) => c.path),
    ['/s/0'],
  );
});

test('thermoBox: allowed, the setpoint is bounded by the ceiling and the device range', async (t) => {
  const { gladys, net } = await setup(t, {
    config: { allow_heating: true, heating_max_temperature: 24 },
  });
  assert.equal((await press(gladys, IDS.thermo, 'target', 21)).success, true);
  const tooHot = await press(gladys, IDS.thermo, 'target', 26);
  assert.equal(tooHot.success, false);
  assert.match(tooHot.error, /entre 5 et 24/);
  assert.equal((await press(gladys, IDS.thermo, 'target', null)).success, false);
  assert.equal((await press(gladys, IDS.thermo, 'target', '')).success, false);
  assert.equal((await press(gladys, IDS.thermo, 'mode', 1)).success, true);
  // Never the mode of the device: a heater is not switched on as a cooler.
  const cooling = await press(gladys, IDS.thermo, 'mode', 2);
  assert.equal(cooling.success, false);
  assert.deepEqual(
    net.commands().map((c) => c.path),
    ['/s/t/2100', '/s/1'],
  );
});

test('shutter: open, stop, position (inverted), with the state read back', async (t) => {
  const { gladys, net } = await setup(t);
  assert.equal((await press(gladys, IDS.shutter, 'state', 1)).success, true);
  assert.equal((await press(gladys, IDS.shutter, 'state', 0)).success, true);
  assert.equal((await press(gladys, IDS.shutter, 'position', 50)).success, true);
  assert.equal((await press(gladys, IDS.shutter, 'state', 5)).success, false);
  assert.deepEqual(
    net.commands().map((c) => c.path),
    ['/s/u', '/s/s', '/s/p/50'],
  );
});

test('light: brightness and colour on the channels of the light only', async (t) => {
  const { gladys, app, net } = await setup(t);
  await createAll(gladys);
  assert.equal((await press(gladys, IDS.light, 'brightness', 50)).success, true);
  assert.equal((await press(gladys, IDS.light, 'color', 0x00ff00)).success, true);
  assert.equal((await press(gladys, IDS.light, 'light', 0)).success, true);
  assert.deepEqual(
    net.commands().map((c) => JSON.parse(c.body).rgbw.desiredColor),
    ['80000000', '00800000', '00000000'],
  );
  await app.publisher.flush();
  assert.equal(gladys.fake.lastState(id(IDS.light, 'light')), 0);
});

test('credentials refused: a stop persisted in /data, no read until the next try', async (t) => {
  const store = new MemoryStore();
  const net = fakeNetwork(undefined, { auth: { username: 'admin', password: 'good-secret' } });
  const { gladys, app, logs } = await setup(t, {
    net,
    store,
    config: { addresses: '192.168.1.40', username: 'admin', password: 'wrong-secret' },
  });
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.match(gladys.fake.connectionStatus.message.fr, /Identifiants refusés par 192\.168\.1\.40/);
  await app.stop();
  assert.equal(store.data.blocks['192.168.1.40'].kind, 'auth');
  const count = net.calls.length;
  await app.poll();
  assert.equal(net.calls.length, count, 'not asked again before the next try');
  // A reconnection to Gladys keeps the stop.
  await gladys.connect();
  assert.equal(net.calls.length, count);
  // Other credentials: asked again at once.
  await gladys.fake.configUpdated({
    addresses: '192.168.1.40',
    username: 'admin',
    password: 'good-secret',
  });
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  const everything = JSON.stringify([logs, store.data, gladys.fake.connectionStatuses]);
  assert.ok(!everything.includes('secret'), 'no password anywhere');
});

test('I2: a 429/5xx pause holds the reads and the openings, never close, stop or off', async (t) => {
  const store = new MemoryStore();
  const { gladys, app, net } = await setup(t, { store, config: { allow_gate_open: true } });
  net.fail('192.168.1.41', '/state/extended', { status: 429, headers: { 'retry-after': '120' } });
  net.fail('192.168.1.42', '/state/extended', { status: 503 });
  app.failures.clear();
  await app.poll();
  const block = app.data.blocks['192.168.1.41'];
  assert.equal(block.kind, 'pause');
  assert.ok(block.until - Date.now() > 100_000 && block.until - Date.now() <= 120_000);
  assert.equal(app.data.blocks['192.168.1.42'].kind, 'pause');
  net.table['192.168.1.41'].gate.currentPos = 50;
  const open = await press(gladys, IDS.gate, 'open');
  assert.equal(open.success, false);
  assert.match(open.error, /demandé d'attendre/);
  assert.equal((await press(gladys, IDS.gate, 'close')).success, true);
  assert.equal((await press(gladys, IDS.thermo, 'mode', 0)).success, true);
  assert.deepEqual(
    net.commands().map((c) => c.path),
    ['/s/c', '/s/0'],
  );
  // Refused credentials hold everything.
  app.data.blocks['192.168.1.42'] = { kind: 'auth', failures: 1, until: Date.now() + 60_000 };
  assert.equal((await press(gladys, IDS.thermo, 'mode', 0)).success, false);
});

test('I3: switching off is always sent, without a state read nor "already off"', async (t) => {
  const { gladys, net } = await setup(t);
  // Read as off (a switching on may still be on its way), and a state read that fails.
  net.fail('192.168.1.42', '/state/extended', new BleBoxError('timeout', { sent: true }));
  assert.equal((await press(gladys, IDS.thermo, 'mode', 0)).success, true);
  assert.deepEqual(
    net.commands().map((c) => c.path),
    ['/s/0'],
  );
});

test('I4: the identity is checked before every command (DHCP swap)', async (t) => {
  const { gladys, net } = await setup(t, { config: { safe_relays: IDS.switch } });
  net.table['192.168.1.40'].routes['GET /api/device/state'] = {
    device: { deviceName: 'Heater', type: 'thermoBox', apiLevel: '20200229', id: 'bb00000000ff' },
  };
  net.table['192.168.1.43'].routes['GET /api/device/state'] = {
    device: { deviceName: 'Gate', type: 'gateBox', apiLevel: '20230102', id: 'aa00000000ff' },
  };
  const relay = await press(gladys, IDS.switch, 'relay-0', 1);
  assert.equal(relay.success, false);
  const stop = await press(gladys, IDS.shutter, 'state', 0);
  assert.equal(stop.success, false);
  assert.equal(net.commands().length, 0);
});

test('I5: a relay removed from the safe list while its command waits is never sent', async (t) => {
  const { gladys, app, net } = await setup(t, { config: { safe_relays: IDS.switch } });
  const release = net.hold('192.168.1.40', '/api/device/state');
  const pending = press(gladys, IDS.switch, 'relay-0', 1);
  await tick();
  app.config = normalizeConfig({ addresses: ALL, safe_relays: '' });
  release();
  const ack = await pending;
  assert.equal(ack.success, false);
  assert.match(ack.error, /pas déclaré sûr/);
  assert.equal(net.commands().length, 0);
});

test('M2: a relay switch kept after leaving the safe list still shows the real state', async (t) => {
  const { gladys, app, net } = await setup(t, { config: { safe_relays: IDS.switch } });
  await createAll(gladys);
  await gladys.fake.configUpdated({ addresses: ALL, safe_relays: '' });
  net.table['192.168.1.40'].routes['GET /state/extended']().relays[0].state = 1;
  app.failures.clear();
  await app.poll();
  await app.publisher.flush();
  assert.equal(gladys.fake.lastState(id(IDS.switch, 'relay-0')), 1);
});

test('M4: a command before the first start is a refusal, never a TypeError', async () => {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const app = new BleBoxApp({
    gladys,
    client: new BleBoxClient({ request: fakeNetwork().request }),
    store: new MemoryStore(),
    timers,
  });
  await assert.rejects(app.setValue({}, { external_id: id(IDS.gate, 'close') }, 1), (err) =>
    /Appareil inconnu/.test(err.message),
  );
});

test('M5: a poll and a read after a command share one request', async (t) => {
  const { app, net } = await setup(t);
  const record = app.data.devices[IDS.thermo];
  app.failures.clear();
  const before = net.calls.filter((c) => c.address === '192.168.1.42').length;
  await Promise.all([app.read(record), app.read(record)]);
  assert.equal(net.calls.filter((c) => c.address === '192.168.1.42').length, before + 1);
});

test('every reconnection publishes the status and the Discovery tab again', async (t) => {
  const { gladys } = await setup(t);
  const statuses = gladys.fake.connectionStatuses.length;
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  await gladys.connect();
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
});

test('the search: mDNS through Gladys, the devices in the Discovery tab', async (t) => {
  const { gladys } = await setup(t, {
    config: { addresses: '' },
    scanResults: {
      mdns: [
        { name: 'gateBox-1', host: 'x.local', addresses: ['192.168.1.41'], port: 80, txt: [] },
        { name: 'noise', host: 'y.local', addresses: ['fe80::1'], port: 80, txt: [] },
      ],
    },
  });
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  const ack = await gladys.fake.action('find_devices');
  assert.equal(ack.success, true);
  assert.match(ack.data.message.fr, /gateBox "Gate" aa0000000001 \(192\.168\.1\.41\)/);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('M6: odd announced addresses ignored, no credentials to an announced address, one scan per 10 s', async (t) => {
  const net = fakeNetwork(undefined, { auth: { username: 'admin', password: 'pw-secret' } });
  const { gladys, net: used } = await setup(t, {
    net,
    config: { addresses: '', username: 'admin', password: 'pw-secret' },
    scanResults: {
      mdns: ['127.0.0.1', '169.254.1.2', '192.168.1.255', '0.0.0.0', '192.168.1.41'].map((ip) => ({
        name: ip,
        host: 'x.local',
        addresses: [ip],
        port: 80,
        txt: [],
      })),
    },
  });
  await gladys.fake.action('find_devices');
  await gladys.fake.action('find_devices');
  assert.equal(gladys.fake.scans.length, 1, 'the second search reuses the first results');
  assert.deepEqual([...new Set(used.calls.map((c) => c.address))], ['192.168.1.41']);
  assert.ok(used.calls.every((c) => c.headers.authorization === undefined));
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.match(
    gladys.fake.connectionStatus.message.fr,
    /protégé par un mot de passe : 192\.168\.1\.41/,
  );
  // Typed: the credentials go, the device is added.
  await gladys.fake.configUpdated({
    addresses: '192.168.1.41',
    username: 'admin',
    password: 'pw-secret',
  });
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});
