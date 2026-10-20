// -----------------------------------------------------------------------------
// The texts users and contributors read are UTF-8 without BOM, and never
// mojibake: UTF-8 bytes read as Latin-1 / Windows-1252 and saved again ("é"
// becoming "Ã" + "©", the apostrophe "’" becoming "â" + "€" + "™"). And a
// secret is never said encrypted: Gladys keeps it in clear in its database.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MOJIBAKE = /[ÂÃ][\u0080-¿€]|â€/;
const FILES = [
  'gladys-assistant-integration.json',
  'docs/en.md',
  'docs/fr.md',
  'README.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'TODO.md',
  'THIRD_PARTY_NOTICES.md',
  'SECURITY.md',
  'src/i18n.js',
];
const ENCRYPTED = /chiffr|encrypt|crypt[ée]/i;

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url));

for (const file of FILES) {
  test(`${file}: UTF-8 without BOM, no mojibake`, () => {
    const bytes = read(file);
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM');
    const text = bytes.toString('utf8');
    assert.ok(!text.includes('�'), 'invalid UTF-8');
    const line = text.split('\n').findIndex((l) => MOJIBAKE.test(l));
    assert.equal(line, -1, `mojibake on line ${line + 1}`);
  });
}

test('the mojibake pattern catches what it should', () => {
  assert.match('FranÃ§ais', MOJIBAKE, 'ç read as Latin-1');
  assert.match('Â«', MOJIBAKE, '« read as Latin-1');
  assert.match('lâ€™app', MOJIBAKE, '’ read as Windows-1252');
  assert.doesNotMatch('Français « Découverte » 800×534 — l’app…', MOJIBAKE);
});

test('a secret is never said encrypted (Gladys keeps it in clear in its database)', () => {
  for (const file of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'src/i18n.js',
  ]) {
    const text = read(file).toString('utf8');
    const line = text.split('\n').findIndex((l) => ENCRYPTED.test(l));
    assert.equal(line, -1, `${file}: line ${line + 1}`);
  }
  const manifest = JSON.parse(read('gladys-assistant-integration.json').toString('utf8'));
  for (const field of manifest.config_schema.filter((f) => f.type === 'secret')) {
    assert.match(field.description.fr, /gardé par Gladys dans sa base, jamais réaffiché/i);
    assert.match(field.description.en, /kept by Gladys in its database, never shown again/i);
  }
});
