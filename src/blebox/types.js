// -----------------------------------------------------------------------------
// The BleBox product types this integration reads, by API level: the path of
// their state, of their extended state (names, control type, colour mode),
// and how they are commanded. Ported from BOX_TYPE_CONF of blebox-uniapi
// (box_types.py, Apache-2.0, BleBox), limited to the supported products.
// A device reports its `apiLevel` (a date as a number); the configuration
// used is the one of the highest level not above it.
// -----------------------------------------------------------------------------

import { DEVICE_ID, cleanText } from '../config.js';

/** The level of the devices that report none. */
export const DEFAULT_API_LEVEL = 20151206;

/**
 * kind: what the integration builds from it (see src/model.js).
 * relayCommand: 'plain' -> /s/<0|1> (first relay only), 'indexed' -> /s/<relay>/<0|1>.
 */
const TYPES = {
  gateBox: {
    20151206: { kind: 'gate', state: '/api/gate/state' },
    20200831: { kind: 'gate', state: '/state/extended', extended: '/state/extended' },
  },
  shutterBox: {
    20180604: {
      kind: 'shutter',
      state: '/api/shutter/state',
      extended: '/api/shutter/extended/state',
    },
  },
  switchBox: {
    20180604: { kind: 'switch', state: '/api/relay/state', relayCommand: 'plain' },
    20190808: {
      kind: 'switch',
      state: '/api/relay/extended/state',
      extended: '/api/relay/extended/state',
      relayCommand: 'plain',
    },
    20200229: {
      kind: 'switch',
      state: '/state/extended',
      extended: '/state/extended',
      relayCommand: 'plain',
    },
    20220114: {
      kind: 'switch',
      state: '/state/extended',
      extended: '/state/extended',
      relayCommand: 'indexed',
    },
  },
  switchBoxD: {
    20190808: {
      kind: 'switch',
      state: '/api/relay/extended/state',
      extended: '/api/relay/extended/state',
      relayCommand: 'indexed',
    },
    20200229: {
      kind: 'switch',
      state: '/state/extended',
      extended: '/state/extended',
      relayCommand: 'indexed',
    },
  },
  thermoBox: {
    20200229: { kind: 'thermo', state: '/state/extended', extended: '/state/extended' },
  },
  tempSensor: {
    20180604: { kind: 'tempSensor', state: '/api/tempsensor/state' },
  },
  airSensor: {
    20180403: { kind: 'air', state: '/api/air/state' },
  },
  multiSensor: {
    20200831: { kind: 'multi', state: '/state', extended: '/state/extended' },
  },
  wLightBox: {
    20151206: { kind: 'light', state: '/api/device/state', set: '/api/rgbw/set', root: 'rgbw' },
    20190808: {
      kind: 'light',
      state: '/api/rgbw/state',
      extended: '/api/rgbw/extended/state',
      set: '/api/rgbw/set',
      root: 'rgbw',
    },
  },
  wLightBoxS: {
    20151206: { kind: 'light', state: '/api/device/state', set: '/api/light/set', root: 'light' },
    20180718: { kind: 'light', state: '/api/light/state', set: '/api/light/set', root: 'light' },
    20200229: {
      kind: 'light',
      state: '/api/rgbw/state',
      extended: '/api/rgbw/extended/state',
      set: '/api/rgbw/set',
      root: 'rgbw',
    },
  },
  dimmerBox: {
    20151206: {
      kind: 'dimmer',
      state: '/api/dimmer/state',
      set: '/api/dimmer/set',
      root: 'dimmer',
    },
  },
};

export const SUPPORTED_TYPES = Object.keys(TYPES);

/** The configuration of a type at an API level, or undefined. */
export function configOf(type, level) {
  if (!Object.hasOwn(TYPES, type)) {
    return undefined;
  }
  const levels = Object.keys(TYPES[type])
    .map(Number)
    .sort((a, b) => b - a);
  const chosen = levels.find((min) => level >= min);
  return chosen === undefined ? undefined : { level: chosen, ...TYPES[type][chosen] };
}

const shortText = (value, max = 64) => cleanText(value, max);

/**
 * The identity of a device from its /api/device/state (or /info) `device`.
 * @returns {{ id, type, product, name, firmware, hardware, apiLevel } | { error: 'invalid' | 'unsupported' | 'version', type? }}
 */
export function parseIdentity(device) {
  const id = typeof device?.id === 'string' ? device.id.trim().toLowerCase() : '';
  let type = shortText(device?.type, 32);
  if (!DEVICE_ID.test(id) || type === '') {
    return { error: 'invalid' };
  }
  const product = shortText(device.product, 32) || type;
  // wLightBoxS answers as a wLightBox on recent firmware (as blebox-uniapi reads it).
  if (type === 'wLightBox' && product === 'wLightBoxS') {
    type = 'wLightBoxS';
  }
  const levelText = device.apiLevel ?? DEFAULT_API_LEVEL;
  const apiLevel = /^\d{8}$/.test(String(levelText)) ? Number(levelText) : NaN;
  if (!Number.isFinite(apiLevel)) {
    return { error: 'invalid' };
  }
  if (!Object.hasOwn(TYPES, type)) {
    return { error: 'unsupported', type };
  }
  if (!configOf(type, apiLevel)) {
    return { error: 'version', type };
  }
  return {
    id,
    type,
    product,
    name: shortText(device.deviceName, 64),
    firmware: shortText(device.fv, 32),
    hardware: shortText(device.hv, 32),
    apiLevel,
  };
}
