// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  ACTIONS,
  GATE_EXTRA,
  GATE_MODE,
  MDNS_SERVICE,
  POLL_INTERVAL,
  THERMO_LIMITS,
} from '../src/constants.js';
import { COLOR_MODE } from '../src/blebox/light.js';
import { buildDevice } from '../src/model.js';
import { assertCoreDevice } from './helpers/coreFeature.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics, one version everywhere', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.gladys_version, '>=5.1.0', 'mediated mDNS discovery');
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-blebox:${manifest.version}`);
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+BleBox|sans\s+lien\s+avec\s+BleBox/i);
    assert.match(docs, /never tested with a real device|jamais testé avec un vrai appareil/i);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder`);
  }
});

test('the mDNS service of the devices is the only capture', () => {
  assert.deepEqual(manifest.network_discovery, [{ type: 'mdns', service: MDNS_SERVICE }]);
  assert.equal(manifest.containers, undefined);
});

test('the configuration matches the code; the sensitive options are off', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  for (const field of manifest.config_schema.filter((f) => f.default !== undefined)) {
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in the code`);
  }
  assert.equal(fields.password.type, 'secret', 'never sent back to the browser');
  assert.equal(fields.allow_gate_open.default, false);
  assert.equal(fields.allow_heating.default, false);
  assert.equal(fields.safe_relays.default, '');
  assert.deepEqual(
    [fields.poll_interval.min, fields.poll_interval.max],
    [POLL_INTERVAL.min, POLL_INTERVAL.max],
  );
  assert.deepEqual(
    [fields.heating_max_temperature.min, fields.heating_max_temperature.max],
    [THERMO_LIMITS.capMin, THERMO_LIMITS.hardMax],
  );
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(
      section.required ?? section.default ?? section.placeholder,
      undefined,
      section.key,
    );
    for (const lang of ['en', 'fr']) {
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang}`);
    }
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
});

test('the actions are the ones the code handles', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
});

test('every feature of every device kind has a numeric min and max and the other core fields', () => {
  const gladys = createFakeGladys({ selector: 'blebox' });
  const relays = [
    { index: 0, name: 'Pump' },
    { index: 1, name: '' },
  ];
  const multi = ['temperature', 'humidity', 'illuminance', 'wind', 'co2', 'activePower']
    .concat(['voltage', 'current', 'rain', 'flood'])
    .map((type, id) => ({ type, id, name: id % 2 ? '' : `S${id}` }));
  const layouts = [
    ['switch', { relays, power: true, voltage: true }],
    ['shutter', { controlType: 1 }],
    ['shutter', { controlType: 8 }],
    ['gate', { mode: GATE_MODE.STEP_BY_STEP, extra: GATE_EXTRA.STOP, secondOutput: true }],
    ['gate', { mode: GATE_MODE.ONLY_OPEN }],
    ['thermo', { main: 1, probes: [0, 2] }],
    ['tempSensor', {}],
    ['air', { pm25: true, pm10: true }],
    ['multi', { sensors: multi }],
    ['dimmer', { channels: 1 }],
    ...Object.values(COLOR_MODE).map((mode) => ['light', { mode, channels: 5 }]),
    ['light', { channels: 3 }],
  ];
  let features = 0;
  for (const [kind, layout] of layouts) {
    const record = { id: 'aabbccddeeff', type: kind, kind, layout, address: '192.168.1.40' };
    for (const safeRelays of [new Set(), new Set(['aabbccddeeff:0'])]) {
      for (const language of ['en', 'fr']) {
        const device = buildDevice(gladys, record, { safeRelays, language });
        features += assertCoreDevice(device, `${kind} ${JSON.stringify(layout)}`);
      }
    }
  }
  // switch 4, shutters 2 + 2, gates 6 + 3, thermo 7, tempSensor 1, air 2, multi 10,
  // dimmer 2, lights: RGBW 3, RGB 3, MONO 10, RGBORW 3, CT 2, CTX2 4, RGBWW 3, 3 channels 3.
  assert.equal(
    features,
    4 * (4 + 2 + 2 + 6 + 3 + 7 + 1 + 2 + 10 + 2 + 3 + 3 + 10 + 3 + 2 + 4 + 3 + 3),
  );
});
