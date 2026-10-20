// -----------------------------------------------------------------------------
// The integration: the BleBox devices it knows (typed addresses, or found by
// mDNS through Gladys), polled over their local HTTP API, the Gladys devices
// built from them, and the commands sent back. index.js only wires the SDK
// handlers to it (src/handlers.js).
//
// Failures (lessons of the previous waves):
//   - credentials refused (HTTP 401/403): a stop of the address persisted in
//     /data, next tries 15 min, 1 h, 6 h then every 24 h, never in a loop;
//     saving other credentials or "Find the BleBox devices" tries again;
//   - HTTP 429 or 5xx: a pause of 1 min to 6 h, persisted in /data, applied
//     to every path (polls, commands, the search);
//   - anything else: 30 s, 1, 2, 5 min, never sooner than the interval;
//   - a reconnection to Gladys clears none of them, but publishes the status
//     and the Discovery tab again.
//
// Commands:
//   - the gate opening (and its second output) and the heating commands
//     (setpoint, switching on) are refused unless the configuration allows
//     them; the option is checked on arrival, after the fresh read and right
//     before the request leaves (beforeSend);
//   - a gate, a thermostat and a shutter stop are decided on a state read
//     just now (never on the values in memory), after checking that the
//     device answering at the address is still this one; refused when a
//     value is missing;
//   - closing or stopping the gate and switching the heating off are never
//     blocked by an option nor by the queue, and cancel an opening or a
//     heating command still waiting to leave;
//   - sent within 3.5 s of the click or refused unsent; answered by 4.3 s;
//     a request that may have reached the device is never answered "not
//     sent": "sent, without confirmation", then reads; never retried;
//   - the ack never waits for a publication to Gladys.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { credentialsKey, normalizeConfig, numberOf, parseAddress } from './config.js';
import {
  BUTTON_PUSH,
  COVER_STATE,
  EXTERNAL_ID_TYPE,
  GATE_DIRECT_API_LEVEL,
  GATE_EXTRA,
  GATE_MODE,
  LIMITS,
  THERMO_LIMITS,
  THERMOSTAT_MODE,
  TIMINGS,
} from './constants.js';
import { ERRORS, T, join, word } from './i18n.js';
import { buildDevice, featuresOf, isSafeRelay, valuesOf } from './model.js';
import { StatePublisher } from './publisher.js';
import { FileStore, emptyData } from './store.js';
import { BleBoxClient } from './blebox/client.js';
import { BleBoxError, reasonOf } from './blebox/errors.js';
import { commandHex, unitsOf } from './blebox/light.js';
import { layoutOf, mergeLayout, readingOf } from './blebox/parse.js';
import { configOf, parseIdentity } from './blebox/types.js';

/** shutterBox control types without a settable position (blebox-uniapi is_slider). */
const NOT_SLIDERS = new Set([2, 8, 13, 15, 17]);

/** Runs `task` over `items`, `limit` at a time. */
async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * An IPv4 address a module may have on a LAN: not loopback, "this network",
 * link-local, multicast or reserved, and not a .0 / .255 (network, broadcast).
 */
export function isLanUnicast(ip) {
  const match = typeof ip === 'string' && /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) {
    return false;
  }
  const [a, b, , d] = match.slice(1).map(Number);
  if ([a, b, d].some((n) => n > 255) || Number(match[3]) > 255) {
    return false;
  }
  return !(a === 0 || a === 127 || a >= 224 || (a === 169 && b === 254) || d === 0 || d === 255);
}

/** A command value, strictly: a finite number or its exact text ('' and null are not 0). */
const strictNumber = (value) => (typeof value === 'boolean' ? undefined : numberOf(value));

export class BleBoxApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'blebox' }),
    client = new BleBoxClient(),
    store = new FileStore(),
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.client = client;
    this.store = store;
    this.now = now;
    this.timers = timers;
    this.config = undefined;
    this.data = undefined;
    this.publisher = new StatePublisher({
      gladys,
      logger,
      now,
      timers,
      interval: TIMINGS.measureInterval,
    });
    /** address -> { lastTry, error?, id?, type? }: what the typed or found addresses answered */
    this.probes = new Map();
    /** id -> reachable */
    this.reachable = new Map();
    /** id -> when the device answering at its address was last checked */
    this.verified = new Map();
    /** id -> { count, next }: transient failures */
    this.failures = new Map();
    /** address -> [previous id, new id] */
    this.conflicts = new Map();
    /** deviceId -> transport badge last published */
    this.transports = new Map();
    /** featureId -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    /** featureId -> { id, key } of the published devices */
    this.features = new Map();
    /** id -> tail of its command queue */
    this.queues = new Map();
    /** id -> tickets of the opening / heating commands not sent yet */
    this.tickets = new Map();
    /** id -> handles of the reads after its last command */
    this.followUps = new Map();
    /** id -> the read of a device in progress (a poll and a follow-up share it) */
    this.reads = new Map();
    /** id -> the gate pulse command between its plan and its answer */
    this.gateFlight = new Map();
    /** id -> { from, until }: after a gate pulse, until the gate is seen elsewhere */
    this.gateGuards = new Map();
    /** The last mDNS results: Gladys refuses two scans within 10 s. */
    this.lastScan = undefined;
    this.lastLostSearch = -Infinity;
    this.polling = undefined;
    this.discovering = undefined;
    this.pollTimer = undefined;
    this.persistTimer = undefined;
    this.lastStatus = undefined;
    this.warned = new Set();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    if (!this.data) {
      this.data = await this.store.load().catch(() => emptyData());
    }
    const previous = this.config;
    this.config = normalizeConfig(raw);
    if (previous && credentialsKey(previous) !== credentialsKey(this.config)) {
      // Other credentials: the addresses that refused the previous ones are asked again.
      this.clearBlocks('auth');
      for (const [address, status] of this.probes) {
        if (status.error === 'auth') {
          this.probes.delete(address);
        }
      }
    }
    // A newly typed address is asked at once (it may have been seen by the search).
    for (const address of this.config.addresses) {
      if (!previous?.addresses.includes(address)) {
        this.probes.delete(address);
      }
    }
    // Gladys keeps the status and the Discovery tab in memory: sent again at every start.
    this.lastStatus = undefined;
    this.transports.clear();
    this.refreshCreated();
    this.publisher.start();
    await this.poll();
    await this.publishDevices();
    await this.publishAllTransports();
    this.schedule();
    this.updateStatus();
  }

  stop() {
    this.publisher.stop();
    this.timers.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    for (const handles of this.followUps.values()) {
      for (const handle of handles) {
        this.timers.clearTimeout(handle);
      }
    }
    this.followUps.clear();
    if (this.persistTimer) {
      this.timers.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      return this.store.save(this.data).catch(() => {});
    }
    return Promise.resolve();
  }

  schedule() {
    this.timers.clearInterval(this.pollTimer);
    this.pollTimer = this.timers.setInterval(() => this.tick(), this.config.pollInterval * 1000);
  }

  tick() {
    return this.poll()
      .then((changed) => (changed ? this.publishDevices() : undefined))
      .then(() => {
        this.searchLost();
        this.updateStatus();
      })
      .catch((err) => this.logger.warn(`Polling failed: ${reasonOf(err)}`));
  }

  /**
   * A device that no longer answers at its address (a new DHCP lease) is
   * searched by mDNS, at most every 5 minutes, in the background: found by
   * its id at another address, it moves there.
   */
  searchLost() {
    const lost = this.records.some((r) => !r.address || this.reachable.get(r.id) === false);
    if (!lost || this.now() - this.lastLostSearch < TIMINGS.lostSearch) {
      return;
    }
    this.lastLostSearch = this.now();
    this.discover()
      .then(() => this.updateStatus())
      .catch((err) => this.logger.debug(`Search failed: ${reasonOf(err)}`));
  }

  persist() {
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = this.timers.setTimeout(() => {
      this.persistTimer = undefined;
      this.store.save(this.data).catch(() => this.logger.warn('Could not save /data'));
    }, TIMINGS.persistDelay);
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  get records() {
    return Object.values(this.data?.devices ?? {});
  }

  // --- Blocks (credentials refused, pauses) ------------------------------------

  blockOf(address) {
    const block = this.data.blocks[address];
    return block && block.until > this.now() ? block : undefined;
  }

  clearBlocks(kind) {
    for (const [address, block] of Object.entries(this.data.blocks)) {
      if (block.kind === kind) {
        delete this.data.blocks[address];
        this.persist();
      }
    }
  }

  /** A failure of an address: credentials refused and pauses are persisted. */
  onFailure(address, err) {
    if (!(err instanceof BleBoxError) || !address) {
      return;
    }
    if (err.kind !== 'auth' && err.kind !== 'busy') {
      return;
    }
    const kind = err.kind === 'auth' ? 'auth' : 'pause';
    const previous = this.data.blocks[address];
    const failures = previous?.kind === kind ? previous.failures + 1 : 1;
    let wait;
    if (kind === 'auth') {
      wait = TIMINGS.authRetries[Math.min(failures, TIMINGS.authRetries.length) - 1];
      this.warnOnce(`auth:${address}:${failures}`, `${address}: credentials refused`);
    } else {
      const asked = err.retryAfter ?? TIMINGS.pauseMin * 2 ** Math.min(failures - 1, 10);
      wait = Math.min(TIMINGS.pauseMax, Math.max(TIMINGS.pauseMin, asked));
      this.logger.warn(`${address}: ${err.message}, paused for ${Math.round(wait / 1000)} s`);
    }
    if (Object.keys(this.data.blocks).length < LIMITS.addresses || previous) {
      this.data.blocks[address] = { kind, failures, until: this.now() + wait };
      this.persist();
    }
  }

  onSuccess(address) {
    if (this.data.blocks[address]) {
      delete this.data.blocks[address];
      this.persist();
    }
  }

  // --- Known devices -----------------------------------------------------------

  /** Adds or updates a known device; true when its Gladys device changes. */
  remember(identity, config, address, layout) {
    const devices = this.data.devices;
    const existing = devices[identity.id];
    if (!existing && Object.keys(devices).length >= LIMITS.devices) {
      this.warnOnce('devices', `More than ${LIMITS.devices} devices: the next ones are ignored`);
      return false;
    }
    let changed = false;
    // One address, one device: another device known at this address has moved.
    for (const other of this.records) {
      if (other.id !== identity.id && other.address === address) {
        this.logger.warn(
          `Two devices at ${address}: ${other.id} was known there, ${identity.id} answers now`,
        );
        this.conflicts.set(address, [other.id, identity.id]);
        other.address = '';
        this.setReachable(other, false);
        changed = true;
      }
    }
    const sameKind = existing?.kind === config.kind;
    const record = {
      id: identity.id,
      type: identity.type,
      product: identity.product,
      kind: config.kind,
      apiLevel: identity.apiLevel,
      name: identity.name || existing?.name || '',
      firmware: identity.firmware,
      address,
      layout: mergeLayout(config.kind, sameKind ? existing.layout : undefined, layout),
    };
    if (JSON.stringify(existing) !== JSON.stringify(record)) {
      devices[identity.id] = record;
      changed = true;
      if (existing && existing.address !== address) {
        this.logger.info(`${record.product} ${record.id} is now at ${address}`);
        this.failures.delete(identity.id);
        for (const [conflict, ids] of this.conflicts) {
          if (ids[0] === identity.id) {
            this.conflicts.delete(conflict);
          }
        }
      }
      this.persist();
    }
    this.verified.set(identity.id, this.now());
    return changed;
  }

  /**
   * Asks an address what it is, and its layout. `anonymous`: an address only
   * announced on the network (neither typed nor known) never gets the
   * credentials; a password there is said in the status instead.
   */
  async probe(address, { anonymous = false } = {}) {
    const status = { lastTry: this.now() };
    this.probes.set(address, status);
    const block = this.blockOf(address);
    if (block) {
      status.error = block.kind;
      return { changed: false };
    }
    try {
      const auth = anonymous ? undefined : this.config.auth;
      const identity = parseIdentity(await this.client.info(address, { auth }));
      if (identity.error) {
        status.error = identity.error === 'invalid' ? 'invalid' : 'unsupported';
        status.type = identity.type;
        this.warnOnce(`unsupported:${address}`, `${address} is not a supported BleBox device`);
        return { changed: false };
      }
      const config = configOf(identity.type, identity.apiLevel);
      const layout = layoutOf(
        config.kind,
        await this.client.get(address, config.extended ?? config.state, { auth }),
      );
      status.id = identity.id;
      this.onSuccess(address);
      return { changed: this.remember(identity, config, address, layout), identity };
    } catch (err) {
      if (anonymous && err.kind === 'auth') {
        // No credentials were sent: nothing to stop, the user types the address.
        status.error = 'typeToAuthenticate';
        return { changed: false, error: err };
      }
      status.error = err.kind ?? 'error';
      this.onFailure(address, err);
      this.logger.debug(`${address}: ${reasonOf(err)}`);
      return { changed: false, error: err };
    }
  }

  needsVerify(record) {
    const last = this.verified.get(record.id);
    return (
      last === undefined ||
      this.reachable.get(record.id) === false ||
      this.now() - last >= TIMINGS.verifyInterval
    );
  }

  /**
   * The device answering at a known address is still this one (a DHCP lease
   * may give the address to another device), and its layout read again.
   * False when it is not: the device waits to be found again; 'updated' when
   * a firmware update changed its API level (its paths follow).
   */
  async verify(record, { timeout } = {}) {
    const address = record.address;
    const auth = this.config.auth;
    const identity = parseIdentity(await this.client.info(address, { auth, timeout }));
    if (identity.id === record.id) {
      this.verified.set(record.id, this.now());
      const config = !identity.error && configOf(identity.type, identity.apiLevel);
      if (
        config &&
        config.kind === record.kind &&
        (identity.apiLevel !== record.apiLevel || identity.firmware !== record.firmware)
      ) {
        record.apiLevel = identity.apiLevel;
        record.firmware = identity.firmware;
        this.persist();
        return 'updated';
      }
      return true;
    }
    this.logger.warn(
      `${address} no longer answers as ${record.product} ${record.id}: searching it again`,
    );
    this.conflicts.set(address, [record.id, identity.id ?? '?']);
    record.address = '';
    this.setReachable(record, false);
    this.persist();
    return false;
  }

  /** One polling round: the new addresses, then every known device. */
  poll() {
    if (!this.polling) {
      this.polling = this.doPoll().finally(() => {
        this.polling = undefined;
      });
    }
    return this.polling;
  }

  async doPoll() {
    let changed = false;
    const known = new Set(this.records.map((record) => record.address));
    // An address that never answered: asked again every minute, never faster
    // than the refresh interval.
    const retry = Math.max(TIMINGS.probeRetry, this.config.pollInterval * 1000);
    const due = this.config.addresses.filter((address) => {
      const status = this.probes.get(address);
      return !known.has(address) && (!status || this.now() - status.lastTry >= retry);
    });
    for (const result of await mapLimit(due, TIMINGS.probeConcurrency, (a) => this.probe(a))) {
      changed ||= result.changed;
    }
    const results = await mapLimit(this.records, TIMINGS.probeConcurrency, (record) =>
      this.read(record),
    );
    return changed || results.some(Boolean);
  }

  /**
   * Reads one device and records its values; true when its Gladys device
   * changes. A read already running for the device is shared (a poll and the
   * reads after a command never ask it twice at once).
   */
  read(record) {
    const running = this.reads.get(record.id);
    if (running) {
      return running;
    }
    const promise = this.doRead(record).finally(() => {
      if (this.reads.get(record.id) === promise) {
        this.reads.delete(record.id);
      }
    });
    this.reads.set(record.id, promise);
    return promise;
  }

  async doRead(record) {
    const { id, address } = record;
    if (!address || this.blockOf(address)) {
      return false;
    }
    const failure = this.failures.get(id);
    if (failure && this.now() < failure.next) {
      return false;
    }
    let config = configOf(record.type, record.apiLevel);
    const auth = this.config.auth;
    let changed = false;
    try {
      if (this.needsVerify(record)) {
        const verified = await this.verify(record);
        if (!verified) {
          return true;
        }
        if (verified === 'updated') {
          changed = true;
          config = configOf(record.type, record.apiLevel);
        }
        if (config.extended && config.extended !== config.state) {
          changed =
            this.updateLayout(record, await this.client.get(address, config.extended, { auth })) ||
            changed;
        }
      }
      const data = await this.client.get(address, config.state, { auth });
      if (config.extended === config.state) {
        changed = this.updateLayout(record, data) || changed;
      }
      this.recordValues(record, readingOf(record.kind, data, record.layout));
      this.failures.delete(id);
      this.onSuccess(address);
      this.setReachable(record, true);
    } catch (err) {
      this.onFailure(address, err);
      const count = (failure?.count ?? 0) + 1;
      const wait = TIMINGS.backoff[Math.min(count, TIMINGS.backoff.length) - 1];
      this.failures.set(id, {
        count,
        next: this.now() + Math.max(wait, this.config.pollInterval * 1000),
      });
      this.logger.debug(`${record.product} ${id} (${address}): ${reasonOf(err)}`);
      this.setReachable(record, false);
    }
    return changed;
  }

  updateLayout(record, data) {
    const layout = mergeLayout(record.kind, record.layout, layoutOf(record.kind, data));
    if (JSON.stringify(layout) === JSON.stringify(record.layout)) {
      return false;
    }
    record.layout = layout;
    this.persist();
    return true;
  }

  recordValues(record, reading) {
    const ids = this.gladys.externalIds(EXTERNAL_ID_TYPE, record.id);
    for (const [key, value] of valuesOf(record, reading, { safeRelays: this.config.safeRelays })) {
      const featureId = ids.feature(key);
      const entry = { state: value };
      this.lastValues.set(featureId, entry);
      if (this.created.has(featureId)) {
        this.publisher.push(featureId, entry);
      }
    }
  }

  setReachable(record, reachable) {
    const previous = this.reachable.get(record.id);
    this.reachable.set(record.id, reachable);
    if (previous !== reachable) {
      this.publishTransport(this.gladys.externalIds(EXTERNAL_ID_TYPE, record.id).device).catch(
        (err) => this.logger.warn(`Transport badge failed: ${reasonOf(err)}`),
      );
    }
  }

  // --- Gladys devices ----------------------------------------------------------

  /**
   * The Discovery tab. A created device never loses a feature: the features
   * it has that the device no longer gives (a relay no longer declared safe,
   * a light mode changed) are published as they are (Gladys would otherwise
   * mark it changed, and "Update" would drop their history).
   */
  async publishDevices() {
    const devices = [];
    const measures = new Set();
    this.features.clear();
    const created = new Map((this.gladys.devices ?? []).map((d) => [d.external_id, d]));
    const options = { safeRelays: this.config.safeRelays, language: this.config.language };
    for (const record of this.records) {
      const device = buildDevice(this.gladys, record, options);
      const ids = this.gladys.externalIds(EXTERNAL_ID_TYPE, record.id);
      for (const { key, spec } of featuresOf(record, options)) {
        const featureId = ids.feature(key);
        this.features.set(featureId, { id: record.id, key });
        if (spec.measure) {
          measures.add(featureId);
        }
      }
      const published = new Set(device.features.map((f) => f.external_id));
      for (const feature of created.get(device.external_id)?.features ?? []) {
        if (!published.has(feature.external_id)) {
          const kept = {};
          for (const field of [
            'name',
            'external_id',
            'category',
            'type',
            'min',
            'max',
            'unit',
            'read_only',
            'has_feedback',
            'keep_history',
          ]) {
            if (feature[field] !== undefined && feature[field] !== null) {
              kept[field] = feature[field];
            }
          }
          device.features.push(kept);
          const key = feature.external_id.slice(ids.device.length + 1);
          this.features.set(feature.external_id, { id: record.id, key });
        }
      }
      devices.push(device);
    }
    this.publisher.configure({ throttled: measures, events: new Set() });
    await this.gladys
      .publishDiscoveredDevices(devices)
      .catch((err) =>
        this.logger.warn(`Publishing the discovered devices failed: ${reasonOf(err)}`),
      );
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const feature of device?.features ?? []) {
      const value = this.lastValues.get(feature.external_id);
      if (value) {
        this.publisher.push(feature.external_id, value);
      }
    }
    if (device?.external_id) {
      await this.publishTransport(device.external_id).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  recordOf(deviceId) {
    return this.records.find(
      (record) => this.gladys.externalIds(EXTERNAL_ID_TYPE, record.id).device === deviceId,
    );
  }

  transportOf(record) {
    return this.reachable.get(record.id) === false
      ? DEVICE_TRANSPORTS.UNREACHABLE
      : DEVICE_TRANSPORTS.LOCAL;
  }

  async publishTransport(deviceId) {
    const record = this.recordOf(deviceId);
    if (!record || !this.reachable.has(record.id) || !this.createdDevices().has(deviceId)) {
      return;
    }
    const transport = this.transportOf(record);
    if (this.transports.get(deviceId) === transport) {
      return;
    }
    this.transports.set(deviceId, transport);
    await this.gladys.publishTransports([{ external_id: deviceId, transport }]);
  }

  async publishAllTransports() {
    const created = this.createdDevices();
    const entries = [];
    for (const record of this.records) {
      const deviceId = this.gladys.externalIds(EXTERNAL_ID_TYPE, record.id).device;
      if (!this.reachable.has(record.id) || !created.has(deviceId)) {
        continue;
      }
      const transport = this.transportOf(record);
      if (this.transports.get(deviceId) !== transport) {
        this.transports.set(deviceId, transport);
        entries.push({ external_id: deviceId, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${reasonOf(err)}`));
    }
  }

  updateStatus() {
    const records = this.records;
    const answering = records.filter((record) => this.reachable.get(record.id)).length;
    const parts = [];
    let connected;
    if (records.length === 0) {
      connected = false;
      parts.push(T.noDevice);
    } else {
      connected = answering > 0;
      parts.push(T.status(answering, records.length));
    }
    const { invalidAddresses, invalidRelays, credentialsProblem } = this.config;
    if (invalidAddresses.length > 0) {
      parts.push(T.invalidAddresses(invalidAddresses));
    }
    if (invalidRelays.length > 0) {
      parts.push(T.invalidRelays(invalidRelays));
    }
    if (credentialsProblem) {
      parts.push(T.credentials[credentialsProblem]);
    }
    const blocked = (kind) =>
      Object.entries(this.data.blocks)
        .filter(([address, block]) => block.kind === kind && this.blockOf(address))
        .map(([address]) => address);
    if (blocked('auth').length > 0) {
      parts.push(T.refused(blocked('auth')));
    }
    if (blocked('pause').length > 0) {
      parts.push(T.paused(blocked('pause')));
    }
    const unsupported = [...this.probes]
      .filter(([, s]) => s.error === 'unsupported' || s.error === 'invalid')
      .map(([address, s]) => (s.type ? `${address} (${s.type.slice(0, 32)})` : address));
    if (unsupported.length > 0) {
      parts.push(T.unsupported(unsupported));
    }
    const protectedOnes = [...this.probes]
      .filter(([, s]) => s.error === 'typeToAuthenticate')
      .map(([address]) => address);
    if (protectedOnes.length > 0) {
      parts.push(T.typeToAuthenticate(protectedOnes));
    }
    for (const [address, [previous, next]] of this.conflicts) {
      parts.push(T.sameAddress(address, previous, next));
    }
    const message = join(parts);
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${reasonOf(err)}`));
  }

  // --- Search ------------------------------------------------------------------

  /**
   * mDNS through Gladys, then the typed addresses; one search at a time.
   * `user`: asked by the user, refused credentials are tried again (a pause
   * is kept); a background search (a lost device) leaves every block.
   */
  discover({ user = false } = {}) {
    if (!this.discovering) {
      this.discovering = this.doDiscover({ user }).finally(() => {
        this.discovering = undefined;
      });
    }
    return this.discovering;
  }

  /** The mDNS services; within 10 s of the last scan, its results (Gladys answers 429). */
  async browse() {
    if (this.lastScan && this.now() - this.lastScan.at < TIMINGS.scanSpacing) {
      return { services: this.lastScan.services, failed: false };
    }
    try {
      const services = await this.gladys.scanNetwork('mdns', {
        timeoutSeconds: TIMINGS.scanSeconds,
      });
      this.lastScan = { at: this.now(), services: Array.isArray(services) ? services : [] };
      return { services: this.lastScan.services, failed: false };
    } catch (err) {
      this.logger.info(`mDNS search failed: ${reasonOf(err)}`);
      return { services: [], failed: true };
    }
  }

  async doDiscover({ user }) {
    const { services, failed } = await this.browse();
    const typed = new Set(this.config.addresses);
    const known = new Set(this.records.map((r) => r.address).filter(Boolean));
    const addresses = new Set(typed);
    for (const service of services.slice(0, LIMITS.devices)) {
      const ip = (service?.addresses ?? []).find((a) => isLanUnicast(a));
      const port = Number.isInteger(service?.port) ? service.port : 80;
      const address = ip ? parseAddress(`${ip}:${port}`) : undefined;
      if (address) {
        addresses.add(address);
      }
    }
    if (user) {
      for (const address of addresses) {
        if (this.data.blocks[address]?.kind === 'auth') {
          delete this.data.blocks[address];
          this.persist();
        }
      }
    }
    const results = await mapLimit([...addresses], TIMINGS.probeConcurrency, async (address) => ({
      address,
      // The credentials only go to your modules: typed or already known addresses.
      ...(await this.probe(address, { anonymous: !typed.has(address) && !known.has(address) })),
    }));
    if (results.some((r) => r.changed)) {
      await this.publishDevices();
    }
    return { failed, found: results.filter((r) => r.identity) };
  }

  async scan() {
    await this.discover({ user: true }).catch((err) =>
      this.logger.warn(`Search failed: ${reasonOf(err)}`),
    );
    await this.poll();
    await this.publishDevices();
    this.updateStatus();
  }

  async findDevices() {
    const { failed, found } = await this.discover({ user: true });
    this.updateStatus();
    if (found.length === 0) {
      return failed && this.config.addresses.length === 0 ? T.find.failed : T.find.none;
    }
    return T.find.found(
      found.map(
        ({ identity, address }) =>
          `${identity.product} ${identity.name ? `"${identity.name}" ` : ''}${identity.id} (${address})`,
      ),
    );
  }

  // --- Commands --------------------------------------------------------------

  refusal(text) {
    const error = new Error(word(text, this.config?.language ?? 'fr'));
    error.refusal = true;
    return error;
  }

  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.now();
    // Before the first start, or a feature not published: a refusal, never a
    // publication awaited by the ack.
    const target = this.data && this.config && this.features.get(feature?.external_id);
    const record = target && this.data.devices[target.id];
    if (!record) {
      throw this.refusal(ERRORS.unknownDevice);
    }
    const entry = featuresOf(record, { safeRelays: this.config.safeRelays }).find(
      (f) => f.key === target.key,
    );
    if (!entry?.spec.command) {
      // A feature kept from before: a relay no longer declared safe, a former light mode.
      throw this.refusal(/^relay-\d+$/.test(target.key) ? ERRORS.unsafeRelay : ERRORS.readOnly);
    }
    const action = { deviceId: record.id, ...this.actionOf(record, entry, value) };
    this.checkOption(action);
    const ticket = { action, cancelled: false, sent: false };
    if (action.protective) {
      // Never behind the queue, and an opening or a heating command still
      // waiting to leave is cancelled.
      for (const pending of this.tickets.get(record.id) ?? []) {
        if (!pending.sent) {
          pending.cancelled = true;
        }
      }
      return this.run(record, action, received, ticket);
    }
    if (action.sensitive) {
      if (!this.tickets.has(record.id)) {
        this.tickets.set(record.id, new Set());
      }
      this.tickets.get(record.id).add(ticket);
    }
    const previous = this.queues.get(record.id) ?? Promise.resolve();
    const run = previous.then(() => this.run(record, action, received, ticket));
    const tail = run.catch(() => {});
    this.queues.set(record.id, tail);
    try {
      return await run;
    } finally {
      this.tickets.get(record.id)?.delete(ticket);
      if (this.queues.get(record.id) === tail) {
        this.queues.delete(record.id);
      }
    }
  }

  /**
   * The permission of a command, read now from the current configuration;
   * refused (nothing sent) when off.
   */
  checkOption(action) {
    if (action.option === 'gate' && !this.config.allowGateOpen) {
      throw this.refusal(ERRORS.gateDisabled);
    }
    if (action.option === 'gatePulse' && !this.config.allowGateOpen) {
      throw this.refusal(ERRORS.gatePulseDisabled);
    }
    if (action.option === 'heating' && !this.config.allowHeating) {
      throw this.refusal(ERRORS.heatingDisabled);
    }
    if (
      action.relay !== undefined &&
      !isSafeRelay(this.config.safeRelays, action.deviceId, action.relay)
    ) {
      throw this.refusal(ERRORS.unsafeRelay);
    }
  }

  /**
   * What a command asks, its value checked strictly: `{ name, plan(reading)
   * -> { path, body? } | { unchanged }, fresh, protective, sensitive, option,
   * relay, pulse }`. `fresh`: decided on the state read just now. `pulse`: a
   * gate movement, one at a time, guarded after it left.
   */
  actionOf(record, { key, spec }, value) {
    const number = strictNumber(value);
    const bad = () => this.refusal(ERRORS.badValue);
    const config = configOf(record.type, record.apiLevel);
    if (record.kind === 'switch') {
      if (number !== 0 && number !== 1) throw bad();
      const index = spec.relay;
      const path = config.relayCommand === 'indexed' ? `/s/${index}/${number}` : `/s/${number}`;
      if (config.relayCommand !== 'indexed' && index !== 0) throw this.refusal(ERRORS.readOnly);
      return { name: `relay ${index} ${number}`, relay: index, plan: () => ({ path }) };
    }
    if (record.kind === 'shutter') {
      if (key === 'state') {
        const path = {
          [COVER_STATE.OPEN]: '/s/u',
          [COVER_STATE.CLOSE]: '/s/d',
          [COVER_STATE.STOP]: '/s/s',
        }[number];
        if (number === undefined || !path) throw bad();
        return {
          name: `shutter ${path}`,
          plan: () => ({ path }),
          // A stop goes first, whatever waits.
          protective: number === COVER_STATE.STOP,
        };
      }
      if (number === undefined || number < 0 || number > 100) throw bad();
      const { controlType, calibrated } = record.layout ?? {};
      if (!calibrated || NOT_SLIDERS.has(controlType)) {
        throw this.refusal(ERRORS.notCalibrated);
      }
      return {
        name: 'shutter position',
        plan: () => ({ path: `/s/p/${100 - Math.round(number)}` }),
      };
    }
    if (record.kind === 'gate') {
      if (number !== BUTTON_PUSH.PRESSED) throw bad();
      return this.gateAction(record, key);
    }
    if (record.kind === 'thermo') {
      return this.thermoAction(key, number);
    }
    if (record.kind === 'light' || record.kind === 'dimmer') {
      return this.lightAction(record, key, spec, number, config);
    }
    throw this.refusal(ERRORS.readOnly);
  }

  /**
   * The gate, after blebox-uniapi (GateBox, GateBoxB) and the official API:
   * - API >= 20210118: /s/o and /s/c, the module decides on its limit
   *   switches (409 when it cannot tell): closing is always allowed;
   * - older: the primary output (/s/p) opens, or steps (open, stop, close,
   *   stop): in step-by-step mode closing is the same pulse as opening, so
   *   it needs the opening permission, and is only sent from a gate seen
   *   fully open; the secondary output (/s/s) is a stop, a close (open/close
   *   mode, always allowed) or a walk-in.
   */
  gateAction(record, key) {
    const direct = record.apiLevel >= GATE_DIRECT_API_LEVEL;
    const layoutMode = record.layout?.mode;
    const modeOf = (r) => r.mode ?? GATE_MODE.STEP_BY_STEP;
    const guarded = (r) => this.checkGateGuard(record, r);
    if (key === 'open') {
      return {
        name: 'gate open',
        fresh: true,
        sensitive: true,
        option: 'gate',
        pulse: true,
        plan: (r) => {
          guarded(r);
          if (r.position === 100) return { unchanged: true };
          if (record.apiLevel >= GATE_DIRECT_API_LEVEL) return { path: '/s/o' };
          if (modeOf(r) === GATE_MODE.STEP_BY_STEP && (r.position !== 0 || r.moving === true)) {
            throw this.refusal(ERRORS.gateNotClosed);
          }
          return { path: '/s/p' };
        },
      };
    }
    if (key === 'close') {
      if (layoutMode === GATE_MODE.ONLY_OPEN) throw this.refusal(ERRORS.gateClosesAlone);
      const separate = direct || layoutMode === GATE_MODE.OPEN_CLOSE;
      return {
        name: 'gate close',
        fresh: true,
        pulse: true,
        // A close that can never open: always allowed, first in line. A
        // step-by-step pulse can: the opening permission, in the queue.
        ...(separate ? { protective: true } : { sensitive: true, option: 'gatePulse' }),
        plan: (r) => {
          guarded(r);
          if (modeOf(r) === GATE_MODE.ONLY_OPEN) throw this.refusal(ERRORS.gateClosesAlone);
          if (r.position === 0 && r.moving !== true) return { unchanged: true };
          // The API level read just now (a firmware update).
          if (record.apiLevel >= GATE_DIRECT_API_LEVEL) return { path: '/s/c' };
          if (modeOf(r) === GATE_MODE.OPEN_CLOSE) return { path: '/s/s' };
          // The wiring changed since the command was classified: never a
          // pulse without the permission.
          if (separate) throw this.refusal(ERRORS.gateModeChanged);
          if (r.position !== 100 || r.moving === true) {
            throw this.refusal(
              r.extra === GATE_EXTRA.STOP ? ERRORS.gateNotOpen : ERRORS.gateNotOpenNoStop,
            );
          }
          return { path: '/s/p' };
        },
      };
    }
    if (key === 'stop') {
      return {
        name: 'gate stop',
        fresh: true,
        protective: true,
        plan: (r) => {
          if (modeOf(r) === GATE_MODE.OPEN_CLOSE || r.extra !== GATE_EXTRA.STOP) {
            throw this.refusal(ERRORS.gateNoStop);
          }
          return { path: '/s/s' };
        },
      };
    }
    if (key === 'second-output') {
      return {
        name: 'gate second output',
        fresh: true,
        sensitive: true,
        option: 'gate',
        plan: (r) => {
          // No mode before API 20230102: never wired as open/close then.
          if (
            r.mode === GATE_MODE.OPEN_CLOSE ||
            (r.extra !== GATE_EXTRA.WALK_IN && r.extra !== GATE_EXTRA.OTHER)
          ) {
            throw this.refusal(ERRORS.gateNoSecond);
          }
          return { path: '/s/s' };
        },
      };
    }
    throw this.refusal(ERRORS.readOnly);
  }

  /**
   * After a gate pulse, no other one until the gate is read elsewhere than
   * where it started (never lifted on an unknown or unchanged position), or
   * the guard expires: a second pulse would stop or reverse it.
   */
  checkGateGuard(record, reading) {
    const guard = this.gateGuards.get(record.id);
    if (!guard) {
      return;
    }
    if (this.now() >= guard.until) {
      this.gateGuards.delete(record.id);
      return;
    }
    if (reading.position !== undefined && reading.position !== guard.from) {
      this.gateGuards.delete(record.id);
      return;
    }
    throw this.refusal(ERRORS.gateJustCommanded);
  }

  thermoAction(key, number) {
    if (key === 'target') {
      if (number === undefined) throw this.refusal(ERRORS.badValue);
      const wanted = Math.round(number * 10) / 10;
      if (wanted < THERMO_LIMITS.hardMin || wanted > this.config.heatingCap) {
        throw this.refusal(ERRORS.outOfRange(THERMO_LIMITS.hardMin, this.config.heatingCap));
      }
      return {
        name: `thermo setpoint ${wanted}`,
        fresh: true,
        sensitive: true,
        option: 'heating',
        plan: (r) => {
          if ([r.desired, r.minimum, r.maximum].includes(undefined)) {
            throw this.refusal(ERRORS.missingValue);
          }
          // The ceiling may have been lowered since the command arrived.
          const low = Math.max(THERMO_LIMITS.hardMin, r.minimum);
          const high = Math.min(THERMO_LIMITS.hardMax, this.config.heatingCap, r.maximum);
          if (low > high) throw this.refusal(ERRORS.missingValue);
          if (wanted < low || wanted > high) throw this.refusal(ERRORS.outOfRange(low, high));
          if (r.desired === wanted) return { unchanged: true };
          return { path: `/s/t/${Math.round(wanted * 100)}` };
        },
      };
    }
    if (key === 'mode') {
      if (number === THERMOSTAT_MODE.OFF) {
        // Idempotent, so always sent: never a state read that could fail or
        // say "already off" while a switching on is still on its way.
        return { name: 'thermo off', protective: true, plan: () => ({ path: '/s/0' }) };
      }
      if (number !== THERMOSTAT_MODE.HEATING && number !== THERMOSTAT_MODE.COOLING) {
        throw this.refusal(ERRORS.badValue);
      }
      return {
        name: `thermo on (${number})`,
        fresh: true,
        sensitive: true,
        option: 'heating',
        plan: (r) => {
          if (r.state === undefined || r.mode === undefined)
            throw this.refusal(ERRORS.missingValue);
          if (r.safetyOff) throw this.refusal(ERRORS.safetyOff);
          // Never the mode of the device itself: only on, in the mode it is set for.
          if (r.mode !== number) throw this.refusal(ERRORS.wrongMode);
          if (r.on) return { unchanged: true };
          return { path: '/s/1' };
        },
      };
    }
    throw this.refusal(ERRORS.readOnly);
  }

  lightAction(record, key, spec, number, config) {
    const what = key.replace(/-\d+$/, '');
    if (what === 'light' && number !== 0 && number !== 1) throw this.refusal(ERRORS.badValue);
    if (what === 'brightness' && (number === undefined || number < 0 || number > 100)) {
      throw this.refusal(ERRORS.badValue);
    }
    if (what === 'color' && (!Number.isInteger(number) || number < 0 || number > 0xffffff)) {
      throw this.refusal(ERRORS.badValue);
    }
    const value = what === 'brightness' ? Math.round(number) : number;
    return {
      name: `${key} ${value}`,
      fresh: true,
      plan: (r) => {
        if (!r.bytes) throw this.refusal(ERRORS.missingValue);
        const unit = unitsOf(record.layout).find((u) => u.key === spec.light.key) ?? spec.light;
        const result = commandHex(unit, r.bytes, r.lastOn, what, value);
        if (result.unchanged) return result;
        if (record.kind === 'dimmer') {
          return { path: config.set, body: { dimmer: { desiredBrightness: result.bytes[0] } } };
        }
        return { path: config.set, body: { [config.root]: { desiredColor: result.hex } } };
      },
    };
  }

  /** One command: the identity, the fresh read, the plan, the request. */
  async run(record, action, received, ticket) {
    try {
      return await this.runCommand(record, action, received, ticket);
    } finally {
      if (this.gateFlight.get(record.id) === ticket) {
        this.gateFlight.delete(record.id);
      }
    }
  }

  async runCommand(record, action, received, ticket) {
    const sendBy = received + TIMINGS.commandSendBy;
    const answerBy = received + TIMINGS.commandAnswerBy;
    const auth = this.config.auth;
    const check = () => {
      if (ticket.cancelled) throw this.refusal(ERRORS.cancelled);
      this.checkOption(action);
      if (!record.address || this.data.devices[record.id] !== record) {
        throw this.refusal(ERRORS.unknownDevice);
      }
      // A pause asked by the device (429, 5xx) holds the reads, never a
      // protective command (one try); refused credentials hold everything.
      const block = this.blockOf(record.address);
      if (block && (block.kind === 'auth' || !action.protective)) {
        throw this.refusal(ERRORS.blocked);
      }
      if (this.now() > sendBy) throw this.refusal(ERRORS.tooSlow);
    };
    check();
    const address = record.address;
    let reading;
    const left = () => sendBy - this.now() - 200;
    try {
      // The device at the address is this one, before every command (a DHCP
      // lease may have given the address to another module).
      if (left() <= 0) throw this.refusal(ERRORS.tooSlow);
      const verified = await this.verify(record, { timeout: left() });
      if (!verified) {
        throw this.refusal(ERRORS.unknownDevice);
      }
      // The paths of the API level read just now (a firmware update).
      const config = configOf(record.type, record.apiLevel);
      if (action.fresh) {
        check();
        if (left() <= 0) throw this.refusal(ERRORS.tooSlow);
        const data = await this.client.get(address, config.state, { auth, timeout: left() });
        reading = readingOf(record.kind, data, record.layout);
        // Shown in the background: the ack never waits for Gladys.
        this.recordValues(record, reading);
      }
    } catch (err) {
      if (err.refusal) throw err;
      this.onFailure(address, err);
      if (err.kind === 'auth' || err.kind === 'busy') throw this.refusal(ERRORS.blocked);
      throw this.refusal(
        err.kind === 'timeout' && left() <= 0 ? ERRORS.tooSlow : ERRORS.unknownState,
      );
    }
    // Cancelled or no longer allowed while it read: said so before any other reason.
    check();
    const plan = action.plan(reading ?? {});
    if (plan.unchanged) {
      // Already so: nothing sent.
      return;
    }
    if (action.pulse) {
      // One gate movement at a time: a second one would stop or reverse it.
      const flying = this.gateFlight.get(record.id);
      if (flying && flying !== ticket) {
        throw this.refusal(ERRORS.gateJustCommanded);
      }
      this.gateFlight.set(record.id, ticket);
    }
    check();
    this.logger.info(`${record.product} ${record.id}: ${action.name}`);
    let answer;
    try {
      const options = {
        auth,
        timeout: Math.max(100, answerBy - this.now()),
        sendWithin: sendBy - this.now(),
        // The very last check, right before the request leaves.
        beforeSend: () => {
          check();
          ticket.sent = true;
        },
      };
      answer = plan.body
        ? await this.client.post(address, plan.path, plan.body, options)
        : await this.client.get(address, plan.path, options);
    } catch (err) {
      if (err.beforeSend) {
        throw err;
      }
      const reason = reasonOf(err);
      if (!err.sent) {
        this.logger.warn(`${record.product} ${record.id}: ${action.name} NOT sent (${reason})`);
        throw this.refusal(err.kind === 'late' ? ERRORS.tooSlow : ERRORS.notSent(reason));
      }
      this.onFailure(address, err);
      this.followUp(record);
      if (err.kind === 'auth' || (err.kind === 'http' && err.status >= 400 && err.status <= 499)) {
        this.logger.warn(`${record.product} ${record.id}: ${action.name} refused (${reason})`);
        throw this.refusal(
          record.kind === 'gate' && err.status === 409 ? ERRORS.gateUnsure : ERRORS.refused(reason),
        );
      }
      // A silence, a dropped connection, a 5xx, an answer that is not JSON:
      // the request may have reached the device.
      this.guardGate(record, action, reading);
      this.logger.warn(
        `${record.product} ${record.id}: ${action.name} sent, NOT confirmed (${reason})`,
      );
      throw this.refusal(ERRORS.sentUnconfirmed(reason));
    }
    this.guardGate(record, action, reading);
    // Relays and lights answer with their new state.
    if (record.kind === 'switch' || record.kind === 'light' || record.kind === 'dimmer') {
      const shown = readingOf(record.kind, answer, record.layout);
      if (shown.bytes || Object.keys(shown.relays ?? {}).length > 0) {
        this.recordValues(record, shown);
      }
    }
    this.followUp(record);
  }

  /** After a gate pulse that may have left: the guard, from the position read before it. */
  guardGate(record, action, reading) {
    if (!action.pulse) {
      return;
    }
    const length = Math.min(reading?.pulseMs ?? 1000, 10_000);
    this.gateGuards.set(record.id, {
      from: reading?.position,
      until: this.now() + Math.min(TIMINGS.gateGuardMax, length + TIMINGS.gateGuard),
    });
  }

  /**
   * Reads after a command, spaced: a gate or a shutter moves for a while.
   * One series per device: a new command replaces the reads of the previous
   * one, and a read shares the one of the polling if it runs (read()).
   */
  followUp(record) {
    for (const handle of this.followUps.get(record.id) ?? []) {
      this.timers.clearTimeout(handle);
    }
    const handles = TIMINGS.followUps.map((delay) =>
      this.timers.setTimeout(() => {
        // Never sooner than a backoff or a pause: read() checks both.
        if (this.data.devices[record.id] === record) {
          this.read(record)
            .then((changed) => (changed ? this.publishDevices() : undefined))
            .catch(() => this.logger.warn('Read after a command failed'));
        }
      }, delay),
    );
    this.followUps.set(record.id, handles);
  }
}
