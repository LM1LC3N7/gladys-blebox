// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form. The password is
// kept here only: never logged, never in /data, never in a status or an error.
// -----------------------------------------------------------------------------

import { LIMITS, POLL_INTERVAL, THERMO_LIMITS } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  addresses: '',
  safe_relays: '',
  allow_gate_open: false,
  allow_heating: false,
  heating_max_temperature: THERMO_LIMITS.capDefault,
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

/** The optional fields without a default in the manifest (the password is a secret). */
const OPTIONAL = { username: '', password: '' };

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
/** What an HTTP basic authentication header carries: printable ASCII, no colon in the user. */
const USER = /^[\x21-\x39\x3b-\x7e]{1,64}$/;
const PASSWORD = /^[\x20-\x7e]{1,128}$/;
/** A BleBox device id: the hexadecimal id of /api/device/state (its MAC on most models). */
export const DEVICE_ID = /^[0-9a-f]{6,32}$/;

/** A text read from a device, without control characters, trimmed and cut. */
export function cleanText(value, max) {
  if (typeof value !== 'string') {
    return '';
  }
  let out = '';
  for (const char of value.slice(0, max * 2)) {
    const code = char.codePointAt(0);
    if (code >= 0x20 && code !== 0x7f) {
      out += char;
    }
  }
  return out.trim().slice(0, max);
}

/**
 * An address typed by the user: an IPv4 address or a host name, with an
 * optional port. A pasted URL ("http://192.168.1.30/api/...") is reduced to
 * its host; credentials in it are refused (they belong in their fields).
 * @returns {string | undefined} `host` or `host:port` (port 80 dropped)
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '' || text.length > 260) {
    return undefined;
  }
  text = text.replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '');
  if (text.includes('@')) {
    return undefined;
  }
  const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(text.toLowerCase());
  if (!match) {
    return undefined;
  }
  const [, host, portText] = match;
  const port = portText === undefined ? 80 : Number(portText);
  if (port < 1 || port > 65535 || host.length > 253) {
    return undefined;
  }
  const valid =
    IPV4.test(host) || (!/^[\d.]+$/.test(host) && host.split('.').every((l) => LABEL.test(l)));
  if (!valid) {
    return undefined;
  }
  return port === 80 ? host : `${host}:${port}`;
}

/** `host[:port]` -> { host, port }. */
export function splitAddress(address) {
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(address);
  return { host: match[1], port: match[2] === undefined ? 80 : Number(match[2]) };
}

/** The addresses list: separated by commas, semicolons, spaces or new lines. */
export function parseAddresses(raw) {
  const valid = [];
  const invalid = [];
  for (const entry of String(raw ?? '').split(/[\s,;]+/)) {
    if (entry === '') {
      continue;
    }
    const address = parseAddress(entry);
    if (!address) {
      // Shown in the status: cut at an '@' (what precedes it may be a password).
      invalid.push(entry.replace(/^.*@/, '…@').slice(0, 60));
      continue;
    }
    if (!valid.includes(address) && valid.length < LIMITS.addresses) {
      valid.push(address);
    }
  }
  return { valid, invalid };
}

/**
 * The relays declared safe to switch: `<device id>` (every relay of the
 * device) or `<device id>:<relay>` (relay numbers from 0), separated by
 * commas, spaces or new lines. Ids are lower-cased; anything else is ignored
 * and listed in `invalid`.
 */
export function parseSafeRelays(raw) {
  const safe = new Set();
  const invalid = [];
  for (const entry of String(raw ?? '').split(/[\s,;]+/)) {
    if (entry === '') {
      continue;
    }
    const match = /^([0-9a-f]{6,32})(?::(\d))?$/i.exec(entry);
    if (!match) {
      invalid.push(entry.slice(0, 40));
      continue;
    }
    safe.add(
      match[2] === undefined ? match[1].toLowerCase() : `${match[1].toLowerCase()}:${match[2]}`,
    );
  }
  return { safe, invalid };
}

/** Only `true` (or the text "true") allows: anything else, missing included, refuses. */
const strictTrue = (value) => value === true || value === 'true';

/** A number typed in the form: a finite number, or undefined ('' and null are not 0). */
export function numberOf(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^\s*-?\d{1,6}(\.\d{1,6})?\s*$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

/** The heating ceiling: whole degrees, never above THERMO_LIMITS.hardMax whatever was typed. */
export function heatingCapOf(value) {
  const number = numberOf(value);
  if (number === undefined) {
    return THERMO_LIMITS.capDefault;
  }
  return Math.min(THERMO_LIMITS.hardMax, Math.max(THERMO_LIMITS.capMin, Math.floor(number)));
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG, ...OPTIONAL };
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (Object.hasOwn(c, key) && value != null) {
      c[key] = value;
    }
  }
  const { valid, invalid } = parseAddresses(c.addresses);
  const relays = parseSafeRelays(c.safe_relays);
  const username = text(c.username);
  const password = typeof c.password === 'string' ? c.password : '';
  let credentialsProblem;
  if (username === '' && password !== '') {
    credentialsProblem = 'passwordWithoutUser';
  } else if (
    (username !== '' && !USER.test(username)) ||
    (password !== '' && !PASSWORD.test(password))
  ) {
    credentialsProblem = 'credentialsInvalid';
  }
  const interval = numberOf(c.poll_interval);
  return {
    addresses: valid,
    invalidAddresses: invalid,
    safeRelays: relays.safe,
    invalidRelays: relays.invalid,
    /** Basic authentication, or undefined (none, or unusable: said in the status). */
    auth: username !== '' && !credentialsProblem ? { username, password } : undefined,
    credentialsProblem,
    allowGateOpen: strictTrue(c.allow_gate_open),
    allowHeating: strictTrue(c.allow_heating),
    heatingCap: heatingCapOf(c.heating_max_temperature),
    pollInterval:
      interval === undefined
        ? POLL_INTERVAL.default
        : Math.min(POLL_INTERVAL.max, Math.max(POLL_INTERVAL.min, Math.round(interval))),
    language: c.language === 'en' ? 'en' : 'fr',
  };
}

/** What the credentials are (compared in memory only, never stored). */
export const credentialsKey = (config) =>
  JSON.stringify([config.auth?.username ?? '', config.auth?.password ?? '']);
