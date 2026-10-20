// -----------------------------------------------------------------------------
// Known BleBox devices -> Gladys devices and values (pure).
//
// A known device (a record of `devices` in /data, see src/store.js) becomes
// one Gladys device whose external ids are built from the device id BleBox
// gives it: `gladys.externalIds('blebox', id)`, whatever its address. Feature
// keys are frozen:
//
//   switchBox(D)  relay-<n> (switch, only for a relay declared safe),
//                 relay-<n>-state (read-only, the others), power, voltage
//   shutterBox    state (open / close / stop), position
//   gateBox       gate (opening sensor), position (read-only),
//                 open, close, stop, second-output: BUTTONS, never a switch
//   thermoBox     temperature, probe-<id>, target, mode, operating-state, safety
//   tempSensor    temperature
//   airSensor     pm25, pm10
//   multiSensor   <type>-<id>
//   wLightBox(S), dimmerBox
//                 light[-n], brightness[-n], color[-n]
//
// A gate or a heating output is never a switch nor a binary: a "turn
// everything off/on" (voice assistants, HomeKit, scenes on switches) must
// never reach them.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  EXTERNAL_ID_TYPE,
  GATE_EXTRA,
  GATE_MODE,
  OPENING_SENSOR_STATE,
  THERMO_LIMITS,
  THERMOSTAT_MODE,
  THERMOSTAT_OPERATING_STATE,
} from './constants.js';
import { readUnit, unitsOf } from './blebox/light.js';
import { FEATURE_NAMES, word } from './i18n.js';

/** shutterBox control types that are curtains (blebox-uniapi ShutterBoxControlType). */
const CURTAINS = new Set([8, 11, 12]);

const sensor = (category, type, min, max, unit, extra = {}) => ({
  category,
  type,
  min,
  max,
  ...(unit ? { unit } : {}),
  read_only: true,
  has_feedback: false,
  keep_history: true,
  measure: true,
  ...extra,
});
const binarySensor = (category) => ({ ...sensor(category, T.SENSOR.BINARY, 0, 1), measure: false });
const button = () => ({
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
  command: true,
});
const command = (category, type, min, max, unit, extra = {}) => ({
  category,
  type,
  min,
  max,
  ...(unit ? { unit } : {}),
  read_only: false,
  has_feedback: true,
  keep_history: true,
  command: true,
  ...extra,
});

const MULTI_SPECS = {
  temperature: () => sensor(C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, -40, 85, U.CELSIUS),
  humidity: () => sensor(C.HUMIDITY_SENSOR, T.SENSOR.DECIMAL, 0, 100, U.PERCENT),
  illuminance: () => sensor(C.LIGHT_SENSOR, T.SENSOR.DECIMAL, 0, 200_000, U.LUX),
  wind: () => sensor(C.SPEED_SENSOR, T.SENSOR.DECIMAL, 0, 100, U.METER_PER_SECOND),
  co2: () => sensor(C.CO2_SENSOR, T.SENSOR.INTEGER, 0, 10_000, U.PPM),
  activePower: () => sensor(C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, -50_000, 50_000, U.WATT),
  voltage: () => sensor(C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, 0, 500, U.VOLT),
  current: () => sensor(C.ENERGY_SENSOR, T.ENERGY_SENSOR.CURRENT, 0, 100_000, U.MILLI_AMPERE),
  rain: () => binarySensor(C.RAIN_SENSOR),
  flood: () => binarySensor(C.LEAK_SENSOR),
};

/** Whether a relay of a device is declared safe to switch in the configuration. */
export const isSafeRelay = (safeRelays, id, index) =>
  safeRelays.has(id) || safeRelays.has(`${id}:${index}`);

/**
 * The features of a known device: `[{ key, spec, name }]`, in a stable order.
 * `name` is `{ en, fr }`.
 */
export function featuresOf(record, { safeRelays = new Set() } = {}) {
  const { kind, layout = {} } = record;
  const out = [];
  const add = (key, spec, name) => out.push({ key, spec, name });
  switch (kind) {
    case 'switch':
      for (const relay of layout.relays ?? []) {
        const label = relay.name ? { en: relay.name, fr: relay.name } : undefined;
        const n = relay.index + 1;
        if (isSafeRelay(safeRelays, record.id, relay.index)) {
          add(
            `relay-${relay.index}`,
            { ...command(C.SWITCH, T.SWITCH.BINARY, 0, 1), relay: relay.index },
            label ?? FEATURE_NAMES.relay(n),
          );
        } else {
          add(
            `relay-${relay.index}-state`,
            binarySensor(C.UNKNOWN),
            label ? FEATURE_NAMES.relayState(relay.name) : FEATURE_NAMES.relayStateN(n),
          );
        }
      }
      if (layout.power) {
        add('power', sensor(C.SWITCH, T.SWITCH.POWER, 0, 10_000, U.WATT), FEATURE_NAMES.power);
      }
      if (layout.voltage) {
        add('voltage', sensor(C.SWITCH, T.SWITCH.VOLTAGE, 0, 500, U.VOLT), FEATURE_NAMES.voltage);
      }
      break;
    case 'shutter': {
      const category = CURTAINS.has(layout.controlType) ? C.CURTAIN : C.SHUTTER;
      const types = category === C.CURTAIN ? T.CURTAIN : T.SHUTTER;
      add(
        'state',
        command(category, types.STATE, -1, 1, undefined, {
          has_feedback: false,
          keep_history: false,
        }),
        FEATURE_NAMES.cover,
      );
      add('position', command(category, types.POSITION, 0, 100), FEATURE_NAMES.position);
      break;
    }
    case 'gate':
      add('gate', binarySensor(C.OPENING_SENSOR), FEATURE_NAMES.gate);
      add('position', sensor(C.UNKNOWN, T.SENSOR.INTEGER, 0, 100), FEATURE_NAMES.gatePosition);
      add('open', button(), FEATURE_NAMES.open);
      // Only the buttons the wiring of the gateBox can do (a created one is kept).
      if (layout.mode !== GATE_MODE.ONLY_OPEN) {
        add('close', button(), FEATURE_NAMES.close);
      }
      if (layout.extra === GATE_EXTRA.STOP && layout.mode !== GATE_MODE.OPEN_CLOSE) {
        add('stop', button(), FEATURE_NAMES.stop);
      }
      if (layout.secondOutput) {
        add('second-output', button(), FEATURE_NAMES.secondOutput);
      }
      break;
    case 'thermo':
      if (layout.main !== undefined) {
        add(
          'temperature',
          sensor(C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, -40, 85, U.CELSIUS),
          FEATURE_NAMES.temperature,
        );
      }
      for (const id of layout.probes ?? []) {
        add(
          `probe-${id}`,
          sensor(C.TEMPERATURE_SENSOR, T.TEMPERATURE_SENSOR.PROBE, -40, 125, U.CELSIUS),
          FEATURE_NAMES.probe(id),
        );
      }
      add(
        'target',
        command(
          C.THERMOSTAT,
          T.THERMOSTAT.TARGET_TEMPERATURE,
          THERMO_LIMITS.hardMin,
          THERMO_LIMITS.hardMax,
          U.CELSIUS,
        ),
        FEATURE_NAMES.target,
      );
      add(
        'mode',
        command(C.THERMOSTAT, T.THERMOSTAT.MODE, THERMOSTAT_MODE.OFF, THERMOSTAT_MODE.COOLING),
        FEATURE_NAMES.mode,
      );
      add(
        'operating-state',
        { ...sensor(C.THERMOSTAT, T.THERMOSTAT.OPERATING_STATE, 0, 2), measure: false },
        FEATURE_NAMES.operating,
      );
      add('safety', binarySensor(C.UNKNOWN), FEATURE_NAMES.safety);
      break;
    case 'tempSensor':
      add(
        'temperature',
        sensor(C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, -55, 125, U.CELSIUS),
        FEATURE_NAMES.temperature,
      );
      break;
    case 'air':
      if (layout.pm25) {
        add(
          'pm25',
          sensor(C.PM25_SENSOR, T.SENSOR.DECIMAL, 0, 1000, U.MICROGRAM_PER_CUBIC_METER),
          FEATURE_NAMES.pm25,
        );
      }
      if (layout.pm10) {
        add(
          'pm10',
          sensor(C.PM10_SENSOR, T.SENSOR.DECIMAL, 0, 1000, U.MICROGRAM_PER_CUBIC_METER),
          FEATURE_NAMES.pm10,
        );
      }
      break;
    case 'multi':
      for (const { type, id, name } of layout.sensors ?? []) {
        add(
          `${type}-${id}`,
          MULTI_SPECS[type](),
          name ? { en: name, fr: name } : FEATURE_NAMES.multi(type, id),
        );
      }
      break;
    case 'light':
    case 'dimmer':
      for (const unit of unitsOf(layout)) {
        const n = unit.key ? Number(unit.key.slice(1)) : undefined;
        add(
          `light${unit.key}`,
          { ...command(C.LIGHT, T.LIGHT.BINARY, 0, 1), light: unit },
          FEATURE_NAMES.light(n),
        );
        add(
          `brightness${unit.key}`,
          { ...command(C.LIGHT, T.LIGHT.BRIGHTNESS, 0, 100), light: unit },
          FEATURE_NAMES.brightness(n),
        );
        if (unit.color) {
          add(
            `color${unit.key}`,
            { ...command(C.LIGHT, T.LIGHT.COLOR, 0, 0xffffff), light: unit },
            FEATURE_NAMES.color(n),
          );
        }
      }
      break;
    default:
      break;
  }
  return out;
}

export function deviceName(record) {
  return (record.name || `BleBox ${record.product || record.type} ${record.id.slice(-4)}`).slice(
    0,
    100,
  );
}

/** The Gladys device of a known device. */
export function buildDevice(gladys, record, { safeRelays, language }) {
  const ids = gladys.externalIds(EXTERNAL_ID_TYPE, record.id);
  const features = featuresOf(record, { safeRelays }).map(({ key, spec, name }) => {
    const feature = {
      name: word(name, language).slice(0, 100),
      external_id: ids.feature(key),
      category: spec.category,
      type: spec.type,
      min: spec.min,
      max: spec.max,
      read_only: spec.read_only,
      has_feedback: spec.has_feedback,
      keep_history: spec.keep_history,
    };
    if (spec.unit) {
      feature.unit = spec.unit;
    }
    return feature;
  });
  const params = [
    { name: 'IP_ADDRESS', value: record.address ?? '' },
    { name: 'DEVICE_ID', value: record.id },
    { name: 'MODEL', value: record.product || record.type },
    { name: 'FIRMWARE', value: record.firmware ?? '' },
  ].filter((param) => param.value !== '');
  return {
    name: deviceName(record),
    external_id: ids.device,
    features,
    params,
    should_poll: false,
  };
}

/** featureKey -> value from a reading (readingOf), only for the features the device has. */
export function valuesOf(record, reading, options) {
  const values = new Map();
  const keys = new Set(featuresOf(record, options).map((f) => f.key));
  const set = (key, value) => {
    if (value !== undefined && value !== null && Number.isFinite(value) && keys.has(key)) {
      values.set(key, value);
    }
  };
  switch (record.kind) {
    case 'switch':
      // Both keys, whatever the declaration: a `relay-<n>` switch kept after
      // the relay left the safe list still shows the real state.
      for (const [index, state] of Object.entries(reading.relays ?? {})) {
        values.set(`relay-${index}`, state);
        values.set(`relay-${index}-state`, state);
      }
      set('power', reading.power);
      set('voltage', reading.voltage);
      break;
    case 'shutter':
      set('position', reading.position);
      break;
    case 'gate':
      if (reading.position !== undefined) {
        set(
          'gate',
          reading.position === 0 ? OPENING_SENSOR_STATE.CLOSE : OPENING_SENSOR_STATE.OPEN,
        );
      }
      set('position', reading.position);
      break;
    case 'thermo': {
      const { main, probes = [] } = record.layout ?? {};
      set('temperature', reading.temperatures?.[main]);
      for (const id of probes) {
        set(`probe-${id}`, reading.temperatures?.[id]);
      }
      set('target', reading.desired);
      if (reading.on !== undefined) {
        const mode = reading.mode === 2 ? THERMOSTAT_MODE.COOLING : THERMOSTAT_MODE.HEATING;
        set('mode', reading.on ? mode : THERMOSTAT_MODE.OFF);
      }
      // As Home Assistant reads it: 1 heating, 2 cooling, 0 and 3 idle.
      if (reading.operating !== undefined) {
        set(
          'operating-state',
          reading.operating === 1
            ? THERMOSTAT_OPERATING_STATE.HEATING
            : reading.operating === 2
              ? THERMOSTAT_OPERATING_STATE.COOLING
              : THERMOSTAT_OPERATING_STATE.IDLE,
        );
      }
      if (reading.safetyOff !== undefined) {
        set('safety', reading.safetyOff ? 1 : 0);
      }
      break;
    }
    case 'tempSensor':
      set('temperature', reading.temperature);
      break;
    case 'air':
      set('pm25', reading.pm25);
      set('pm10', reading.pm10);
      break;
    case 'multi':
      for (const [key, value] of Object.entries(reading.values ?? {})) {
        set(key, value);
      }
      break;
    case 'light':
    case 'dimmer':
      if (reading.bytes) {
        for (const unit of unitsOf(record.layout)) {
          const shown = readUnit(unit, reading.bytes, reading.effect);
          if (shown) {
            set(`light${unit.key}`, shown.on);
            set(`brightness${unit.key}`, shown.brightness);
            set(`color${unit.key}`, shown.color);
          }
        }
      }
      break;
    default:
      break;
  }
  return values;
}
