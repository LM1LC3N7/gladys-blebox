// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data (the one writable
// volume): the known devices (found by the search, kept by id when their
// address changes) and the blocks of the addresses (credentials refused, a
// pause asked by the device), so that a restart never hammers a device.
// Never a password: the credentials stay in the Gladys configuration.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEVICE_ID, parseAddress } from './config.js';
import { LIMITS, TIMINGS } from './constants.js';
import { configOf } from './blebox/types.js';

export const emptyData = () => ({ devices: {}, blocks: {} });

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A known device as remember() writes it: its type, level, kind and address agree. */
function validRecord(record) {
  return (
    isObject(record) &&
    typeof record.type === 'string' &&
    Number.isInteger(record.apiLevel) &&
    configOf(record.type, record.apiLevel)?.kind === record.kind &&
    typeof record.address === 'string' &&
    (record.address === '' || parseAddress(record.address) === record.address) &&
    isObject(record.layout)
  );
}

/**
 * What a file holds, checked: unknown keys dropped, ids checked, a block
 * never ends later than its longest bound from now (a clock that jumped, a
 * file edited by hand).
 */
export function sanitize(data, now = Date.now()) {
  const base = emptyData();
  if (!isObject(data)) {
    return base;
  }
  if (isObject(data.devices)) {
    for (const [id, record] of Object.entries(data.devices).slice(0, LIMITS.devices)) {
      if (DEVICE_ID.test(id) && validRecord(record) && record.id === id) {
        base.devices[id] = record;
      }
    }
  }
  if (isObject(data.blocks)) {
    for (const [address, block] of Object.entries(data.blocks).slice(0, LIMITS.addresses)) {
      // An address as the configuration gives it ("__proto__" is not one).
      if (
        parseAddress(address) !== address ||
        !isObject(block) ||
        !['auth', 'pause'].includes(block.kind)
      ) {
        continue;
      }
      const longest = block.kind === 'auth' ? TIMINGS.authRetries.at(-1) : TIMINGS.pauseMax;
      const until = Number.isFinite(block.until) ? Math.min(block.until, now + longest) : now;
      const failures = Number.isInteger(block.failures)
        ? Math.min(Math.max(block.failures, 1), 100)
        : 1;
      base.blocks[address] = { kind: block.kind, until, failures };
    }
  }
  return base;
}

export class FileStore {
  constructor({
    dir = process.env.DATA_DIR || '/data',
    name = 'blebox.json',
    now = Date.now,
  } = {}) {
    this.dir = dir;
    this.path = join(dir, name);
    this.now = now;
  }

  async load() {
    try {
      return sanitize(JSON.parse(await readFile(this.path, 'utf8')), this.now());
    } catch {
      return emptyData();
    }
  }

  async save(data) {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

/** For the tests. */
export class MemoryStore {
  constructor(data = emptyData(), now = Date.now) {
    this.data = structuredClone(data);
    this.saves = 0;
    this.now = now;
  }

  async load() {
    return sanitize(structuredClone(this.data), this.now());
  }

  async save(data) {
    this.data = structuredClone(data);
    this.saves += 1;
  }
}
