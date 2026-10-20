# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for BleBox Wi-Fi modules (local
HTTP API, no cloud): a Node.js service (Node 22+, ESM, no build step) that runs
in its own sandboxed Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template
and ports blebox-uniapi (Apache-2.0). See `TODO.md` for the status and the
decisions.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "gate"    # tests whose name matches
npm run cover                             # regenerate cover.png (800×534)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: src/handlers.js registered before connect()
src/handlers.js                   the SDK handlers -> BleBoxApp (shared with the tests)
src/app.js                        BleBoxApp: known devices, polling, blocks, commands, search
src/blebox/http.js                one HTTP request: deadline, size cap, sent flag, beforeSend
src/blebox/client.js              GET / POST JSON, basic auth, statuses -> error kinds
src/blebox/types.js               product type + API level -> paths (pure)
src/blebox/parse.js               answers -> layouts and readings (pure)
src/blebox/light.js               colour modes, channels, masked commands (pure)
src/model.js                      known devices -> Gladys devices and values (pure)
src/publisher.js                  states within the rate limit (250/min), measures spaced
src/store.js                      /data/blebox.json (known devices, blocks), never a password
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/constants.js, src/i18n.js     frozen keys, limits, timings; texts in English and French
scripts/cover.mjs                 cover.png generator (plain Node)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and fake devices
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** `gladys.externalIds('blebox', id)`, `id`
  being the device id BleBox gives, never a label nor an address. Feature
  keys, manifest keys and action keys are frozen too. A created device never
  loses a feature (see `publishDevices`).
- **Safety.** A gate or a heating output is never a `switch` nor a
  commandable `binary`. A relay is a switch only when declared safe. Gate
  opening and heating commands stay off by default, checked on arrival,
  after the fresh read and in `beforeSend`; closing, stopping and switching
  off are never blocked and cancel what waits. A command is decided on a
  state read just now, never on memory. Keep the tests that say so.
- **The container rootfs is read-only.** Write only under `/data`. Never log
  or store a password; a `secret` field is kept by Gladys in its database,
  never shown again: never write that it is encrypted.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json`, `package-lock.json` or the manifest, nor the
  `docker_image` tag, by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }` objects. The catalog
  `description` holds 10 to 100 characters per language.
- **Units.** Only the ones the core lists for the category
  (`DEVICE_FEATURE_UNITS_BY_CATEGORY` in `server/utils/constants.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only).
- **Encoding.** Every file is UTF-8 without BOM; `test/encoding.test.js`
  refuses mojibake.
