# gladys-blebox

[Gladys Assistant](https://gladysassistant.com) external integration for
**BleBox** Wi-Fi modules, on the local network: lights (wLightBox, wLightBoxS,
dimmerBox), relays (switchBox, switchBoxD), shutters (shutterBox), gate
(gateBox), heating (thermoBox) and sensors (tempSensor, airSensor,
multiSensor) become Gladys devices of the Discovery tab, through the official
local HTTP API of the modules, without the BleBox cloud. Unofficial, not
affiliated with BleBox.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress.** First milestone, tested against the sample answers of
> blebox-uniapi only, never with a real device.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (BleBoxApp)
                                   ├─ src/blebox/http.js     one HTTP request (node:http): deadline, size cap, beforeSend
                                   ├─ src/blebox/client.js   GET / POST JSON, basic auth, statuses -> kinds
                                   ├─ src/blebox/types.js    product type + API level -> paths (pure)
                                   ├─ src/blebox/parse.js    answers -> layouts and readings (pure)
                                   ├─ src/blebox/light.js    colour modes, channels, masked commands (pure)
                                   ├─ src/model.js           known devices -> Gladys devices and values (pure)
                                   ├─ src/publisher.js       states within 250/min (Gladys: 300), measures spaced
                                   └─ src/store.js           /data/blebox.json: known devices, blocks
```

- **Devices** are added by IP address (configuration), or found with
  `gladys.scanNetwork('mdns')` (`_bbxsrv._tcp`). Each one is identified with
  `GET /api/device/state` (`/info` on the oldest firmware): its `id`, `type`
  and `apiLevel` choose the paths, as `BOX_TYPE_CONF` of blebox-uniapi does.
  Kept in `/data` by id (external ids `blebox:<id>`), so a new IP address
  changes nothing; the id answering at an address is checked again every
  10 minutes and before every gate or heating command.
- **Polling** every `poll_interval` seconds of the state path of each module.
- **Commands**: `GET /s/...` (relays, shutters, gate, thermoBox) or
  `POST /api/rgbw/set` (lights, the other channels masked with `--`).
- **Safety**: a relay is read only until declared safe; the gate is never a
  switch (buttons only), its opening and the heating commands are off by
  default; closing, stopping and switching off are never blocked and cancel
  a pending opening. See [docs/en.md](docs/en.md#command-safety).

## Development

```bash
npm install
npm test                                        # node --test, no network (loopback only)
npm run lint && npm run format:check
npm run audit
npm run cover                                   # regenerates cover.png (800×534, no dependency)
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/helpers/fakeBlebox.js` holds device answers shaped like the fixtures of
blebox-uniapi behind a fake `request`; the end-to-end tests run the real
handlers against the SDK's fake Gladys.

## Credits

- [`blebox-uniapi`](https://github.com/blebox/blebox_uniapi) by BleBox
  (Apache-2.0), the library behind the Home Assistant BleBox integration: the
  product types, API levels, paths, field names, scales and light masks are
  taken from it (ported to JavaScript, no file copied).
- `src/publisher.js` comes from
  [LM1LC3N7/gladys-ikea](https://github.com/LM1LC3N7/gladys-ikea) and
  `src/blebox/http.js` from
  [LM1LC3N7/gladys-bsblan](https://github.com/LM1LC3N7/gladys-bsblan) (same
  author, Apache-2.0).

BleBox is a trademark of its owner, used here only to name the compatible
products.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release.

## License

Apache-2.0, see [LICENSE](LICENSE). Third-party notices (blebox-uniapi,
Apache-2.0): [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
