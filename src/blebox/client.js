// -----------------------------------------------------------------------------
// The local HTTP API of the BleBox devices (plain HTTP, no cloud), after the
// official API documentation and blebox-uniapi (Apache-2.0, BleBox): a GET
// or a POST of JSON, answered with JSON. Optional HTTP basic authentication
// (set in the wBox app). Every answer is size-capped and parsed once.
// -----------------------------------------------------------------------------

import { LIMITS, TIMINGS } from '../constants.js';
import { splitAddress } from '../config.js';
import { BleBoxError } from './errors.js';
import { httpRequest } from './http.js';

/** Retry-After in ms (seconds or an HTTP date), or undefined. */
export function retryAfterOf(header, now = Date.now()) {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value.length > 64) {
    return undefined;
  }
  if (/^\s*\d{1,9}\s*$/.test(value)) {
    return Number(value) * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export class BleBoxClient {
  constructor({ request = httpRequest, timeout = TIMINGS.requestTimeout, now = Date.now } = {}) {
    this.request = request;
    this.timeout = timeout;
    this.now = now;
  }

  /**
   * One exchange. `address` is host[:port].
   * @param {object} [options]
   * @param {{ username: string, password: string }} [options.auth]
   * @param {number} [options.timeout] ms for the whole exchange
   * @param {number} [options.sendWithin] ms to start, else not sent ('late')
   * @param {() => void} [options.beforeSend]
   * @returns {Promise<object | Array>} the JSON answer
   */
  async exchange(
    address,
    path,
    { method = 'GET', body, auth, timeout, sendWithin, beforeSend } = {},
  ) {
    const { host, port } = splitAddress(address);
    const headers = {};
    if (auth) {
      headers.authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
    }
    const answer = await this.request({
      method,
      host,
      port,
      path,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      timeout: timeout ?? this.timeout,
      sendWithin,
      maxBytes: LIMITS.responseBytes,
      beforeSend,
    });
    const { status } = answer;
    if (status === 401 || status === 403) {
      throw new BleBoxError('auth', { status, sent: true });
    }
    if (status === 429 || (status >= 500 && status <= 599)) {
      throw new BleBoxError('busy', {
        status,
        sent: true,
        retryAfter: retryAfterOf(answer.headers?.['retry-after'], this.now()),
      });
    }
    if (status < 200 || status > 299) {
      throw new BleBoxError('http', { status, sent: true });
    }
    if (answer.body.length === 0) {
      return {};
    }
    let parsed;
    try {
      parsed = JSON.parse(answer.body.toString('utf8'));
    } catch {
      throw new BleBoxError('invalid', { sent: true });
    }
    if (parsed === null || typeof parsed !== 'object') {
      throw new BleBoxError('invalid', { sent: true });
    }
    return parsed;
  }

  get(address, path, options) {
    return this.exchange(address, path, { ...options, method: 'GET' });
  }

  post(address, path, body, options) {
    return this.exchange(address, path, { ...options, method: 'POST', body });
  }

  /**
   * The identity of the device: /api/device/state on recent firmware, /info
   * on the oldest ones (as blebox-uniapi). The `device` object, or the
   * answer itself when it has none.
   */
  async info(address, options) {
    let data;
    try {
      data = await this.get(address, '/api/device/state', options);
    } catch (err) {
      if (err.kind !== 'http' && err.kind !== 'invalid') {
        throw err;
      }
      data = await this.get(address, '/info', options);
    }
    const device =
      data && !Array.isArray(data) && Object.hasOwn(data, 'device') ? data.device : data;
    if (!device || typeof device !== 'object' || Array.isArray(device)) {
      throw new BleBoxError('invalid', { sent: true });
    }
    return device;
  }
}
