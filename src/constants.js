// -----------------------------------------------------------------------------
// Fixed values: manifest keys (frozen: users store them in their scenes and
// configuration), the Gladys core value enums the SDK does not export, limits
// and timings.
// -----------------------------------------------------------------------------

/** The external id type: `gladys.externalIds('blebox', <device id>)`. Frozen. */
export const EXTERNAL_ID_TYPE = 'blebox';

/** Manifest `actions` keys. */
export const ACTIONS = {
  FIND: 'find_devices',
};

/** mDNS service the BleBox devices announce (the one Home Assistant browses). */
export const MDNS_SERVICE = '_bbxsrv._tcp';

// Gladys core enums (server/utils/constants.js), not exported by the SDK.
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const THERMOSTAT_MODE = { OFF: 0, HEATING: 1, COOLING: 2 };
export const THERMOSTAT_OPERATING_STATE = { IDLE: 0, HEATING: 1, COOLING: 2 };
export const BUTTON_PUSH = { PRESSED: 1 };

/** gateBox `openCloseMode` (blebox-uniapi GateBoxControlType). */
export const GATE_MODE = { STEP_BY_STEP: 0, ONLY_OPEN: 1, OPEN_CLOSE: 2 };
/** gateBox `extraButtonType` (blebox-uniapi GateBoxExtraButtonType). */
export const GATE_EXTRA = { DISABLED: 0, STOP: 1, WALK_IN: 2, OTHER: 3 };

/** thermoBox `state` (blebox-uniapi BleboxThermoState). */
export const THERMO_STATE = { OFF: 0, ON: 1, BOOST: 3, SAFETY_OFF: 4 };
/** thermoBox `mode`: what the output drives. */
export const THERMO_MODE = { HEATING: 1, COOLING: 2 };

/** Sensor reading `state` (blebox-uniapi BleboxSensorState). */
export const SENSOR_STATE = { IDLE: 0, INITIALIZING: 1, ACTIVE: 2, ERROR: 3, NOT_CONFIGURED: 6 };

/**
 * Room setpoint of a thermoBox, in °C: never below HARD_MIN nor above
 * the configured ceiling, itself never above HARD_MAX whatever is typed.
 */
export const THERMO_LIMITS = { hardMin: 5, hardMax: 30, capDefault: 25, capMin: 10 };

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin. */
  statesPerMinute: 250,
  /** Devices handled (each one is polled over HTTP). */
  devices: 100,
  /** Addresses typed in the configuration. */
  addresses: 100,
  /** Body of a device answer. */
  responseBytes: 64 * 1024,
  /** Relays, sensors and light channels read from one device. */
  relays: 8,
  sensors: 16,
};

export const TIMINGS = {
  /** One HTTP request of the polling. */
  requestTimeout: 5000,
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** Measurements (power, temperature, air) of a feature are spaced by this much. */
  measureInterval: 60_000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** An address that never answered is tried again this often. */
  probeRetry: 60_000,
  /** The device answering at a known address is checked again this often (DHCP). */
  verifyInterval: 10 * 60_000,
  /** Saving /data waits this long for more changes. */
  persistDelay: 1000,
  /** mDNS browse (seconds, 1-30). */
  scanSeconds: 5,
  /** Devices asked at once after a search. */
  probeConcurrency: 8,
  /**
   * A command leaves within this many ms of its arrival, or is refused
   * unsent: Gladys gives up waiting for the ack after 5 s.
   */
  commandSendBy: 3500,
  /** The ack is given by then: past it, "sent, without confirmation". */
  commandAnswerBy: 4300,
  /** Reads after a command (a gate or a shutter moves for a while). */
  followUps: [1500, 6000, 20_000],
  /** Transient failures: the next reads, never sooner than the interval. */
  backoff: [30_000, 60_000, 120_000, 300_000],
  /** Credentials refused: the next tries, then every 24 h. */
  authRetries: [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000],
  /** HTTP 429 or 5xx: a pause within these bounds. */
  pauseMin: 60_000,
  pauseMax: 6 * 60 * 60_000,
};

/** Configuration bounds (mirrored by the manifest). */
export const POLL_INTERVAL = { default: 10, min: 5, max: 300 };
