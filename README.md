# eacp-updater

Updater-owned libraries split out of core EACP.

This repo contains:

- Library code in `Lib/`.
- `eacp-updater`: catalog, artifact, receipt, install, and privilege request primitives.
- `eacp-hub`: channel/catalog loading and product catalog helpers for hub-style update apps.
- User/demo code in `Demos/`.
- `Demos/AppHub`: a sample hub app.
- `Demos/HelloWorldDemo`: a sample product app that updates from a hub.
- Library tests in `Tests/Updater` and `Tests/Hub`.
- Demo AppHub tests in `Tests/Demos/AppHub`.
- Update packaging, publishing, signing, promotion, and local demo scripts.

Core EACP is consumed through CPM from `eyalamirmusic/eacp@main`; updater and hub
targets are defined here.

The boundary is intentional:

- `Lib/` is the reusable SDK surface for building hub updaters and hub-managed apps.
- `Demos/` is sample user code that links the libraries.
- `Scripts/` automates publishing/signing/demo workflows for the sample apps.

## Build

```sh
cmake -S . -B build
cmake --build build
ctest --test-dir build
```

Disable demos when you only want the reusable libraries:

```sh
cmake -S . -B build-lib -DEACP_UPDATER_BUILD_DEMOS=OFF
```

## Publish AppHub

The local AppHub update path is the same script CI runs:

```sh
op run --env-file=.github/op/tamber-signing.env -- \
  node Scripts/build-and-publish-app.mjs apphub "$VERSION" "$APPHUB_CHANNEL"
```

That builds, signs, notarizes, packages `AppHub-${VERSION}.pkg`, uploads the app
update artifacts to the GitHub release, and uploads the installer package plus
`hub-installer.json` to the configured AppHub bucket channel.

To publish only the AppHub channel metadata for an already-uploaded installer
package:

```sh
node Scripts/update-apphub-channel.mjs stable 2.0.0
```

That validates `channels/stable/artifacts/AppHub-2.0.0.pkg`, writes an empty
AppHub product catalog, updates `index.json`, and writes `hub-installer.json`.
