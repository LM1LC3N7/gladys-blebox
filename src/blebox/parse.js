// -----------------------------------------------------------------------------
// BleBox answers -> what the integration knows (pure). Two steps:
//
// - layoutOf(kind, data): what a device HAS (its relays, sensors, light
//   channels, gate mode...), read from its extended state when it has one.
//   It decides the Gladys features, so it only grows (see mergeLayout).
// - readingOf(kind, data, layout): what a device SHOWS now, in Gladys units.
//
// Every value is checked (a number where a number is expected, within its
// range); a missing or odd one is left out, never guessed. Field names and
// scales come from blebox-uniapi (Apache-2.0, BleBox).
// -----------------------------------------------------------------------------

import { cleanText } from '../config.js';
import { GATE_EXTRA, GATE_MODE, LIMITS, SENSOR_STATE, THERMO_STATE } from '../constants.js';
import { bytesOf } from './light.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** An own property only: a key like "__proto__" or "constructor" is never followed. */
const own = (object, key) =>
  isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;
const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const name = (v) => cleanText(v, 40);

/** A sensor reading usable now: not in error, not unconfigured, not initializing. */
const usable = (sensor) => {
  const state = own(sensor, 'state');
  return !(
    state === SENSOR_STATE.ERROR ||
    state === SENSOR_STATE.NOT_CONFIGURED ||
    state === SENSOR_STATE.INITIALIZING
  );
};

/** The relays of a switchBox answer: an array (oldest API) or `relays`. */
const relaysOf = (data) => list(Array.isArray(data) ? data : own(data, 'relays'), LIMITS.relays);

/** The sensors of an answer: `sensors` at its root, or under `multiSensor`. */
const sensorsOf = (data) => [
  ...list(own(own(data, 'multiSensor'), 'sensors'), LIMITS.sensors),
  ...list(own(data, 'sensors'), LIMITS.sensors),
];

/** The gate object: `gate` (API 20200831) or the answer itself (older). */
const gateOf = (data) => (isObject(own(data, 'gate')) ? own(data, 'gate') : data);

/** multiSensor types read: scale, rounding digits, binary. */
export const MULTI_TYPES = {
  temperature: { scale: 100, digits: 1 },
  humidity: { scale: 100, digits: 1 },
  illuminance: { scale: 100, digits: 0 },
  wind: { scale: 10, digits: 1 },
  co2: { scale: 1, digits: 0 },
  activePower: { scale: 1, digits: 1 },
  voltage: { scale: 10, digits: 1 },
  current: { scale: 1, digits: 0 },
  rain: { binary: true },
  flood: { binary: true },
};

// --- Layouts -----------------------------------------------------------------

export function layoutOf(kind, data) {
  switch (kind) {
    case 'switch': {
      const relays = [];
      for (const relay of relaysOf(data)) {
        const index = int(own(relay, 'relay'), 0, LIMITS.relays - 1);
        if (index !== undefined && !relays.some((r) => r.index === index)) {
          relays.push({ index, name: name(own(relay, 'name')) });
        }
      }
      if (relays.length === 0 && Array.isArray(data)) {
        relays.push({ index: 0, name: '' });
      }
      const types = new Set(sensorsOf(data).map((s) => own(s, 'type')));
      return { relays, power: types.has('activePower'), voltage: types.has('voltage') };
    }
    case 'shutter': {
      const shutter = own(data, 'shutter');
      return {
        controlType: int(own(shutter, 'controlType'), 0, 99),
        calibrated: Boolean(own(own(shutter, 'calibrationParameters'), 'isCalibrated')),
      };
    }
    case 'gate': {
      const gate = gateOf(data);
      const mode = int(own(gate, 'openCloseMode'), 0, 2);
      const extra = int(own(gate, 'extraButtonType'), 0, 3);
      return {
        legacy: !isObject(own(data, 'gate')),
        // No openCloseMode before API 20230102: the outputs are then wired as
        // step-by-step (or only-open), never as open/close.
        mode,
        extra,
        // The second output as its own button (walk-in, other), as blebox-uniapi.
        secondOutput:
          isObject(own(data, 'gate')) &&
          (extra === GATE_EXTRA.WALK_IN || extra === GATE_EXTRA.OTHER) &&
          mode !== GATE_MODE.OPEN_CLOSE,
      };
    }
    case 'thermo': {
      const safety = int(own(own(own(data, 'thermo'), 'safetyTempSensor'), 'sensorId'), 0, 99);
      const ids = [];
      for (const sensor of sensorsOf(data)) {
        const id = int(own(sensor, 'id'), 0, 99);
        if (own(sensor, 'type') === 'temperature' && id !== undefined && !ids.includes(id)) {
          ids.push(id);
        }
      }
      ids.sort((a, b) => a - b);
      // The room sensor: the first one that is not the safety (floor) sensor.
      const main = ids.find((id) => id !== safety);
      return { main, probes: ids.filter((id) => id !== main) };
    }
    case 'tempSensor':
      return {};
    case 'air': {
      const types = list(own(own(data, 'air'), 'sensors'), LIMITS.sensors).map((s) =>
        own(s, 'type'),
      );
      return { pm25: types.includes('pm2.5'), pm10: types.includes('pm10') };
    }
    case 'multi': {
      const sensors = [];
      for (const sensor of sensorsOf(data)) {
        const type = own(sensor, 'type');
        const id = int(own(sensor, 'id'), 0, 99);
        if (
          typeof type === 'string' &&
          Object.hasOwn(MULTI_TYPES, type) &&
          id !== undefined &&
          !sensors.some((s) => s.type === type && s.id === id)
        ) {
          sensors.push({ type, id, name: name(own(sensor, 'name')) });
        }
      }
      return { sensors };
    }
    case 'light':
    case 'dimmer': {
      const root = own(data, 'rgbw') ?? own(data, 'light') ?? own(data, 'dimmer');
      const bytes = kind === 'dimmer' ? [0] : bytesOf(own(root, 'desiredColor'));
      return {
        kind,
        mode: int(own(root, 'colorMode'), 1, 7),
        channels: bytes ? bytes.length : 0,
      };
    }
    default:
      return {};
  }
}

/**
 * The layout only grows: a relay, a sensor or a light channel missing from
 * one answer (a firmware hiccup) never removes a feature; a mode change does
 * switch the lights (their former features are kept by the publication).
 */
export function mergeLayout(kind, previous, next) {
  if (!previous) {
    return next;
  }
  switch (kind) {
    case 'switch':
      return {
        relays: [
          ...previous.relays.map((r) => next.relays.find((n) => n.index === r.index) ?? r),
          ...next.relays.filter((n) => !previous.relays.some((r) => r.index === n.index)),
        ].sort((a, b) => a.index - b.index),
        power: previous.power || next.power,
        voltage: previous.voltage || next.voltage,
      };
    case 'thermo':
      return next.main === undefined ? previous : next;
    case 'air':
      return { pm25: previous.pm25 || next.pm25, pm10: previous.pm10 || next.pm10 };
    case 'multi':
      return {
        sensors: [
          ...previous.sensors,
          ...next.sensors.filter(
            (n) => !previous.sensors.some((s) => s.type === n.type && s.id === n.id),
          ),
        ],
      };
    case 'light':
    case 'dimmer':
      return next.channels > 0 ? next : previous;
    default:
      return next;
  }
}

// --- Readings ----------------------------------------------------------------

/** Celsius from hundredths, rounded to 0.1. */
const celsius = (v) => (num(v) === undefined ? undefined : round(v / 100, 1));

export function readingOf(kind, data, layout) {
  switch (kind) {
    case 'switch': {
      const relays = {};
      for (const relay of relaysOf(data)) {
        const index = int(own(relay, 'relay'), 0, LIMITS.relays - 1);
        const state = int(own(relay, 'state'), 0, 1);
        if (index !== undefined && state !== undefined) {
          relays[index] = state;
        }
      }
      const reading = { relays };
      for (const sensor of sensorsOf(data)) {
        const value = num(own(sensor, 'value'));
        if (value === undefined || !usable(sensor)) {
          continue;
        }
        if (own(sensor, 'type') === 'activePower') {
          reading.power = round(Math.max(0, value), 1);
        } else if (own(sensor, 'type') === 'voltage') {
          reading.voltage = round(value / 10, 1);
        }
      }
      return reading;
    }
    case 'shutter': {
      const shutter = own(data, 'shutter');
      const position = int(own(own(shutter, 'currentPos'), 'position'), 0, 100);
      return {
        state: int(own(shutter, 'state'), 0, 8),
        // BleBox: % closed (0 open); Gladys: % open.
        position: position === undefined ? undefined : 100 - position,
      };
    }
    case 'gate': {
      const gate = gateOf(data);
      const position = int(own(gate, 'currentPos'), 0, 100);
      const desired = int(own(gate, 'desiredPos'), 0, 100);
      return {
        position,
        mode: layout?.legacy ? undefined : int(own(gate, 'openCloseMode'), 0, 2),
        extra: int(own(gate, 'extraButtonType'), 0, 3),
        // Only the legacy API gives desiredPos; the recent ones never tell a move.
        moving: desired !== undefined && position !== undefined ? desired !== position : undefined,
        pulseMs: int(own(gate, 'gatePulseTimeMs'), 0, 60_000),
      };
    }
    case 'thermo': {
      const thermo = own(data, 'thermo');
      const state = int(own(thermo, 'state'), 0, 4);
      const temperatures = {};
      for (const sensor of sensorsOf(data)) {
        const id = int(own(sensor, 'id'), 0, 99);
        if (id !== undefined && own(sensor, 'type') === 'temperature' && usable(sensor)) {
          const value = celsius(own(sensor, 'value'));
          if (value !== undefined && value > -60 && value < 130) {
            temperatures[id] = value;
          }
        }
      }
      return {
        state,
        on:
          state === undefined
            ? undefined
            : state === THERMO_STATE.ON || state === THERMO_STATE.BOOST,
        safetyOff: state === undefined ? undefined : state === THERMO_STATE.SAFETY_OFF,
        mode: int(own(thermo, 'mode'), 0, 2),
        operating: int(own(thermo, 'operatingState'), 0, 3),
        desired: celsius(own(thermo, 'desiredTemp')),
        minimum: celsius(own(thermo, 'minimumTemp')),
        maximum: celsius(own(thermo, 'maximumTemp')),
        temperatures,
      };
    }
    case 'tempSensor': {
      const sensor = list(own(own(data, 'tempSensor'), 'sensors'), LIMITS.sensors).find(
        (s) => own(s, 'id') === 0,
      );
      const value = sensor && usable(sensor) ? celsius(own(sensor, 'value')) : undefined;
      return { temperature: value !== undefined && value > -60 && value < 130 ? value : undefined };
    }
    case 'air': {
      const reading = {};
      for (const sensor of list(own(own(data, 'air'), 'sensors'), LIMITS.sensors)) {
        const value = num(own(sensor, 'value'));
        if (value === undefined || value < 0 || !usable(sensor)) {
          continue;
        }
        if (own(sensor, 'type') === 'pm2.5') {
          reading.pm25 = value;
        } else if (own(sensor, 'type') === 'pm10') {
          reading.pm10 = value;
        }
      }
      return reading;
    }
    case 'multi': {
      const values = {};
      for (const sensor of sensorsOf(data)) {
        const type = own(sensor, 'type');
        const id = int(own(sensor, 'id'), 0, 99);
        const value = num(own(sensor, 'value'));
        if (
          typeof type !== 'string' ||
          !Object.hasOwn(MULTI_TYPES, type) ||
          id === undefined ||
          value === undefined ||
          !usable(sensor)
        ) {
          continue;
        }
        const spec = MULTI_TYPES[type];
        values[`${type}-${id}`] = spec.binary
          ? value
            ? 1
            : 0
          : round(value / spec.scale, spec.digits);
      }
      return { values };
    }
    case 'light': {
      const root = own(data, 'rgbw') ?? own(data, 'light');
      return {
        bytes: bytesOf(own(root, 'desiredColor')),
        lastOn: bytesOf(own(root, 'lastOnColor')),
        effect: int(own(root, 'effectID'), 0, 255) ?? 0,
      };
    }
    case 'dimmer': {
      const level = int(own(own(data, 'dimmer'), 'desiredBrightness'), 0, 255);
      return { bytes: level === undefined ? undefined : [level], effect: 0 };
    }
    default:
      return {};
  }
}
