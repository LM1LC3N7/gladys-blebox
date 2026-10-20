// -----------------------------------------------------------------------------
// The HTTP layer: the client's status mapping (fake request), and node:http on
// a loopback server for the deadlines, the size cap and beforeSend. Loopback
// only: nothing leaves the machine.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BleBoxClient, retryAfterOf } from '../src/blebox/client.js';
import { httpRequest } from '../src/blebox/http.js';

const answer =
  (status, body = '', headers = {}) =>
  async () => ({
    status,
    headers,
    body: Buffer.from(body),
  });

test('client: statuses become kinds, never a body nor a header in the message', async () => {
  const kindOf = async (request) => {
    try {
      await new BleBoxClient({ request }).get('192.168.1.40', '/state');
      return 'ok';
    } catch (err) {
      return [err.kind, err.message];
    }
  };
  assert.deepEqual(await kindOf(answer(401, 'secret page')), ['auth', 'auth (HTTP 401)']);
  assert.deepEqual(await kindOf(answer(503)), ['busy', 'busy (HTTP 503)']);
  assert.deepEqual(await kindOf(answer(404)), ['http', 'http (HTTP 404)']);
  assert.deepEqual(await kindOf(answer(200, '<html>')), ['invalid', 'invalid']);
  assert.deepEqual(await kindOf(answer(200, '42')), ['invalid', 'invalid']);
  assert.equal(await kindOf(answer(200, '{"a":1}')), 'ok');
  assert.equal(retryAfterOf('120'), 120_000);
  assert.equal(retryAfterOf('soon'), undefined);
});

test('client: basic authentication header, /info when /api/device/state is missing', async () => {
  const seen = [];
  const request = async ({ path, headers }) => {
    seen.push([path, headers.authorization]);
    return path === '/info'
      ? { status: 200, headers: {}, body: Buffer.from('{"id":"aabbccddeeff","type":"gateBox"}') }
      : { status: 404, headers: {}, body: Buffer.alloc(0) };
  };
  const device = await new BleBoxClient({ request }).info('10.0.0.2:8080', {
    auth: { username: 'admin', password: 'pw' },
  });
  assert.equal(device.id, 'aabbccddeeff');
  assert.deepEqual(seen, [
    ['/api/device/state', `Basic ${Buffer.from('admin:pw').toString('base64')}`],
    ['/info', `Basic ${Buffer.from('admin:pw').toString('base64')}`],
  ]);
});

async function server(t, handler) {
  const srv = http.createServer(handler);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => srv.close(resolve)));
  srv.unref();
  return srv.address().port;
}

const base = (port, extra = {}) => ({
  method: 'GET',
  host: '127.0.0.1',
  port,
  path: '/s/p',
  timeout: 2000,
  maxBytes: 1024,
  ...extra,
});

test('http: an answer, the size cap, a silence after sending', async (t) => {
  const port = await server(t, (req, res) => {
    if (req.url === '/big') {
      res.end('x'.repeat(5000));
    } else if (req.url === '/silent') {
      // never answers
    } else {
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    }
  });
  const ok = await httpRequest(base(port));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.toString(), '{"ok":true}');
  await assert.rejects(httpRequest(base(port, { path: '/big' })), { kind: 'tooLarge' });
  await assert.rejects(httpRequest(base(port, { path: '/silent', timeout: 200 })), {
    kind: 'timeout',
    sent: true,
  });
});

test('http: beforeSend refuses, nothing reaches the device', async (t) => {
  let hits = 0;
  const port = await server(t, (req, res) => {
    hits += 1;
    res.end('{}');
  });
  const refusal = new Error('not allowed any more');
  await assert.rejects(
    httpRequest(
      base(port, {
        beforeSend: () => {
          throw refusal;
        },
      }),
    ),
    (err) => err === refusal && err.beforeSend === true && err.sent === false,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(hits, 0);
});

test('http: no connection is "not sent"', async () => {
  // A port nothing listens on, on loopback.
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  await assert.rejects(httpRequest(base(port)), { kind: 'unreachable', sent: false });
});
