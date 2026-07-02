# @tamber-inc/eacp-publish

Build, sign, notarize, and publish an [eacp-updater](https://github.com/Tamber-Inc/eacp-updater)
app suite — a hub plus its managed apps — from one config file.

The design is hybrid: this CLI orchestrates (CMake, codesign, notarytool,
uploads), while all channel **metadata** — `index.json`, `catalog.json`,
per-product manifests — is emitted and validated by `eacp-updater-tool`, a
small binary built from the updater library itself. The files you publish are
written by the same reflection code the shipped apps parse them with, so the
wire format cannot drift.

## Setup

```jsonc
// .npmrc (once per machine or repo)
@tamber-inc:registry=https://npm.pkg.github.com
```

In CMake, declare each app once — this replaces hand-rolled version defines,
manifest-URL defines, and Info.plist wiring:

```cmake
eacp_updater_add_app(Anvil
    PRODUCT_ID com.acme.Anvil
    NAME "ACME Anvil"
    SOURCES Main.cpp
    LINK_LIBRARIES eacp-graphics eacp-network eacp-updater)

eacp_updater_add_app(AcmeHub HUB
    PRODUCT_ID com.acme.Hub
    NAME "ACME Hub"
    SOURCES Main.cpp
    LINK_LIBRARIES eacp-apphub eacp-graphics eacp-hub eacp-network eacp-updater)
```

Then:

```sh
npx eacp-publish init      # writes eacp-publish.json — fill in hosting + products
```

```json
{
  "hosting": {
    "storageRoot": "gs://acme-artifacts/suite",
    "publicRoot": "https://storage.googleapis.com/acme-artifacts/suite"
  },
  "channels": { "default": "stable" },
  "signing": { "macos": { "notarize": true } },
  "build": { "macOSDeploymentTarget": "11.0" },
  "hub": { "productId": "com.acme.Hub", "target": "AcmeHub" },
  "products": {
    "com.acme.Anvil": { "target": "Anvil" }
  }
}
```

That file is read by **both** the CLI and `eacp_updater_add_app()`, so the
manifest URLs baked into your binaries always match where the publisher
uploads.

## Release

```sh
op run --env-file=.github/op/acme-signing.env -- \
  npx eacp-publish release 1.2.3
```

Flags: `--channel beta`, `--no-notarize`, `--dry-run` (stages the full upload
tree locally so you can inspect it), `--cmake-arg -DCPM_eacp-updater_SOURCE=…`
for co-development against a local library checkout.

## Inspect and verify

```sh
npx eacp-publish status    # live versions per channel
npx eacp-publish verify    # download everything a fresh install would, check sha256s
```

## Hosting backends

`gs://…` storage roots use `gcloud`; plain paths are treated as a local
directory (which is also the dry-run/test backend). Anything else: point
`hosting.backend` at a module exporting `createBackend(config)` with
`upload`, `fetchText`, and `publicUrl` — four functions, bring your own CDN.
