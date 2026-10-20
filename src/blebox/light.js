// -----------------------------------------------------------------------------
// wLightBox, wLightBoxS and dimmerBox colours (pure), after light.py of
// blebox-uniapi (Apache-2.0, BleBox). A wLightBox holds up to five 8-bit
// channels in one hex string, `desiredColor` ("ff8000ff"); its `colorMode`
// says how they are used, and so which Gladys lights they become:
//
//   1 RGBW, 4 RGBorW   one light, colour: RGB + white       bytes 0-3
//   2 RGB              one light, colour                    bytes 0-2
//   3 MONO             one dimmable light per channel       byte i
//   5 CT               one dimmable light (warm + cold)     bytes 0-1
//   6 CTx2             two dimmable lights                  bytes 0-1, 2-3
//   7 RGBWW            one light, colour: RGB + two whites  bytes 0-4
//
// A command writes only the channels of its light: the others are sent as
// "--", which the device leaves unchanged (the masks of blebox-uniapi).
// -----------------------------------------------------------------------------

export const COLOR_MODE = { RGBW: 1, RGB: 2, MONO: 3, RGBORW: 4, CT: 5, CTX2: 6, RGBWW: 7 };

const HEX = /^(?:[0-9a-f]{2}){1,5}$/i;

/** "ff8000" -> [255, 128, 0], or undefined. */
export function bytesOf(hex) {
  if (typeof hex !== 'string' || !HEX.test(hex)) {
    return undefined;
  }
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

const hexOf = (byte) => byte.toString(16).padStart(2, '0');

/**
 * The Gladys lights of a device: `{ key, bytes: [indexes], color }`, `key`
 * being the feature key suffix ('' for the only light, '-<n>' otherwise).
 * @param {{ mode?: number, channels: number, kind: 'light' | 'dimmer' }} layout
 */
export function unitsOf(layout) {
  const { mode, channels } = layout;
  if (layout.kind === 'dimmer' || channels <= 1) {
    return [{ key: '', bytes: [0], color: false }];
  }
  const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
  switch (mode) {
    case COLOR_MODE.RGB:
      return [{ key: '', bytes: range(0, 3), color: true }];
    case COLOR_MODE.MONO:
      return range(0, Math.min(channels, 5)).map((i) => ({
        key: `-${i + 1}`,
        bytes: [i],
        color: false,
      }));
    case COLOR_MODE.CT:
      return [{ key: '', bytes: [0, 1], color: false }];
    case COLOR_MODE.CTX2:
      return [
        { key: '-1', bytes: [0, 1], color: false },
        { key: '-2', bytes: [2, 3], color: false },
      ];
    case COLOR_MODE.RGBWW:
      return channels >= 5
        ? [{ key: '', bytes: range(0, 5), color: true }]
        : [{ key: '', bytes: range(0, Math.min(channels, 4)), color: true }];
    default:
      // RGBW, RGBorW, and the oldest firmware without a colour mode.
      return channels >= 4
        ? [{ key: '', bytes: range(0, 4), color: true }]
        : [{ key: '', bytes: range(0, Math.min(channels, 3)), color: channels >= 3 }];
  }
}

/** What a light shows: `{ on, brightness (%), color (RGB integer) }`. */
export function readUnit(unit, bytes, effect = 0) {
  const own = unit.bytes.map((i) => bytes[i]);
  if (own.some((b) => b === undefined)) {
    return undefined;
  }
  const max = Math.max(...own);
  const reading = {
    on: max > 0 || (Number.isInteger(effect) && effect > 0) ? 1 : 0,
    brightness: Math.round((max / 255) * 100),
  };
  if (unit.color) {
    const rgb = own.slice(0, 3);
    const top = Math.max(...rgb);
    if (top > 0) {
      const [r, g, b] = rgb.map((v) => Math.round((v * 255) / top));
      reading.color = (r << 16) | (g << 8) | b;
    }
  }
  return reading;
}

/** Bytes scaled so that their maximum is `level` (0-255), ratios kept. */
function scale(bytes, level) {
  const max = Math.max(...bytes);
  if (max === 0) {
    return bytes.map(() => level);
  }
  return bytes.map((b) => Math.min(255, Math.round((b * level) / max)));
}

/**
 * The desiredColor of a command on one light, the other channels masked:
 * `{ hex }`, or `{ unchanged: true }` when the light already shows it.
 * @param {object} unit from unitsOf
 * @param {number[]} current bytes read just now
 * @param {number[] | undefined} lastOn the `lastOnColor` bytes, if any
 * @param {'light' | 'brightness' | 'color'} what
 * @param {number} value 0/1, a percentage, an RGB integer
 */
export function commandHex(unit, current, lastOn, what, value) {
  const own = unit.bytes.map((i) => current[i] ?? 0);
  const ownLast = lastOn ? unit.bytes.map((i) => lastOn[i] ?? 0) : undefined;
  const isOn = Math.max(...own) > 0;
  const onBase = isOn ? own : ownLast && Math.max(...ownLast) > 0 ? ownLast : own.map(() => 255);
  let next;
  if (what === 'light') {
    if ((value === 1) === isOn) {
      return { unchanged: true };
    }
    next = value === 1 ? onBase : own.map(() => 0);
  } else if (what === 'brightness') {
    next =
      value === 0 ? own.map(() => 0) : scale(onBase, Math.max(1, Math.round((value * 255) / 100)));
  } else {
    // A colour: RGB at the current brightness (full when off), the whites off.
    const level = isOn ? Math.max(...own) : 255;
    const rgb = scale([(value >> 16) & 255, (value >> 8) & 255, value & 255], level);
    next = own.map((_, i) => (i < 3 ? rgb[i] : 0));
  }
  const channels = Math.max(current.length, ...unit.bytes.map((i) => i + 1));
  const parts = Array.from({ length: channels }, () => '--');
  unit.bytes.forEach((index, i) => {
    parts[index] = hexOf(next[i]);
  });
  return { hex: parts.join(''), bytes: next };
}
