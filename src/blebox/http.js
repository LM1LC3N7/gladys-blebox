// -----------------------------------------------------------------------------
// The only network access of the integration: one plain HTTP request to a
// BleBox device on node:http (the devices speak no TLS). A deadline for the
// whole exchange, a size cap on the body, no redirect followed, no
// keep-alive. Resolves { status, headers, body } for any status; rejects a
// BleBoxError for the transport failures, with `sent` true as soon as the
// connection was up (the request may then have reached the device).
// `sendWithin`: the connection must be up within this many ms, else nothing
// is written (a command never leaves late). `beforeSend`: the last check of
// a command, once connected, right before the first byte is written.
// Adapted from LM1LC3N7/gladys-bsblan (same author, Apache-2.0).
// -----------------------------------------------------------------------------

import http from 'node:http';
import { BleBoxError } from './errors.js';

function transportError(err, sent) {
  const code = String(err?.code ?? '');
  // Something answered, but not in HTTP (a wrong port).
  if (code.startsWith('HPE_')) {
    return new BleBoxError('invalid', { sent });
  }
  // Only our own words: a system message may carry an address.
  return new BleBoxError('unreachable', { sent });
}

/**
 * @param {object} options
 * @param {'GET' | 'POST'} options.method
 * @param {string} options.host
 * @param {number} options.port
 * @param {string} options.path
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body] a JSON text
 * @param {number} options.timeout ms for the whole exchange
 * @param {number} [options.sendWithin] ms to have the connection up, else not sent
 * @param {number} options.maxBytes body size cap
 * @param {() => void} [options.beforeSend] if it throws, nothing is sent and
 *   its error is passed on with `beforeSend` set
 */
export function httpRequest({
  method,
  host,
  port,
  path,
  headers = {},
  body,
  timeout,
  sendWithin,
  maxBytes,
  beforeSend,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req = null;
    // Until the connection is up, nothing of the request has left.
    let connected = false;

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(sendTimer);
      if (error) {
        req?.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(
      () => finish(new BleBoxError('timeout', { sent: connected })),
      Math.max(0, timeout),
    );
    const sendTimer =
      sendWithin === undefined
        ? null
        : setTimeout(
            () => {
              if (!connected) {
                finish(new BleBoxError('late'));
              }
            },
            Math.max(0, sendWithin),
          );
    const markConnected = () => {
      if (connected || settled) {
        return;
      }
      clearTimeout(sendTimer);
      if (beforeSend) {
        try {
          beforeSend();
        } catch (err) {
          err.beforeSend = true;
          err.sent = false;
          finish(err);
          return;
        }
      }
      connected = true;
      req.end(body ?? '');
    };

    try {
      const payload = body === undefined ? undefined : Buffer.from(body, 'utf8');
      req = http.request({
        method,
        host,
        port,
        path,
        agent: false,
        headers: {
          accept: 'application/json',
          host: port === 80 ? host : `${host}:${port}`,
          connection: 'close',
          'content-length': String(payload?.length ?? 0),
          ...(payload ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
      });
      req.on('response', (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            finish(new BleBoxError('tooLarge', { sent: true }));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          finish(null, {
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', (err) => finish(transportError(err, true)));
      });
      req.on('socket', (socket) => {
        if (!socket.connecting) {
          markConnected();
        } else {
          socket.once('connect', markConnected);
        }
      });
      req.on('error', (err) => finish(transportError(err, connected)));
    } catch (err) {
      // http.request throws on a header it refuses: a failure, never a crash.
      finish(transportError(err, false));
    }
  });
}
