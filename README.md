# eacp-updater

Updater-owned libraries split out of core EACP.

This repo contains:

- Library code in `Lib/`.
- `eacp-updater`: catalog, artifact, receipt, install, and privilege request primitives.
- `eacp-hub`: channel/catalog loading and product catalog helpers for hub-style update apps.
- User/demo code in `Demos/`.
- `Demos/AppHub`: a sample hub app.
- `Demos/RealUpdateDemo`: a sample product app that updates from a hub.
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
