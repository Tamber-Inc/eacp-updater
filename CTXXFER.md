# Context Transfer

Repo: `/Users/jamiepond/projects/eacp-updater`

Date: 2026-06-30

## User Intent

- Keep updater/hub/AppHub code in this repo, not in core EACP.
- Keep the boundary clear:
  - `Lib/` is reusable library code.
  - `Demos/` is user/demo code.
  - `Demos/AppHub` and associated demo apps are examples.
- Make it easy to build hub apps and apps that update from hub apps.
- Use canonical core EACP through CPM from `eyalamirmusic/eacp@main`.
- Move demo-app hosting/publishing CI into this repo.
- Privileged helper code can live in the library.
- Updater should be opinionated; enums like `HubProductKind`, `HubInstallState`, `HubOperationKind`, `HubOperationState`, `HubHelperState` belong in library code.
- Do not spend time formatting scripts. Focus on correctness and getting apps to build.
- Add a signed/notarized AppHub `.pkg`, built locally and in CI through the same script path, uploaded to the cloud bucket and GitHub release.

## Current State

Top-level `CMakeLists.txt` consumes core EACP with CPM:

```cmake
CPMAddPackage(
    NAME eacp
    GITHUB_REPOSITORY eyalamirmusic/eacp
    GIT_TAG main)
```

It does not use `EACP_SOURCE_DIR`. This repo owns its own test option, `EACP_UPDATER_ENABLE_TESTS`, and forces core `EACP_ENABLE_TESTS OFF`.

Fresh CPM network fetch timed out in this environment, so canonical-main compatibility was validated using a temp copy of sibling `../eacp` with stale `Updater`/`Hub` targets removed from core. Direct local override to current sibling `../eacp` still fails because that checkout still contains stale updater/hub targets.

## Library/Demo Split

Library targets:

- `Lib/eacp/Updater`: updater primitives.
- `Lib/eacp/Hub`: channel/catalog helpers.
- `Lib/eacp/AppHub`: opinionated AppHub runtime pieces.

`Lib/eacp/AppHub` contains:

- `AppHubPlatform.h`
- `AppHubPlatform-macOS.mm`
- `AppHubPlatform-Windows.cpp`
- `AppHubTypes.h`
- `CMakeLists.txt`

`Lib/eacp/AppHub/AppHubTypes.h` defines library enums in namespace `eacp::AppHub`:

- `HubProductKind`
- `HubInstallState`
- `HubOperationKind`
- `HubOperationState`
- `HubHelperState`

`Demos/AppHub/AppHubApi.h` includes `<eacp/AppHub/AppHubTypes.h>` and aliases those enum types for demo API compatibility.

## Privileged Helper

Privileged helper implementation was moved into the library:

- `Lib/eacp/Updater/PrivilegedHelper/PrivilegedHelper.h`
- `Lib/eacp/Updater/PrivilegedHelper/PrivilegedHelper-macOS.mm`
- `Lib/eacp/Updater/PrivilegedHelper/PrivilegedHelper-Unsupported.cpp`

Main API shape:

```cpp
namespace eacp::Updater {
  struct PrivilegedHelperInstallResult {
    bool ok;
    std::string error;
  };

  PrivilegedHelperInstallResult installPrivilegedHelper(std::string helperLabel);

  InstallResult installAppBundleWithPrivilegedHelper(
    std::string helperLabel,
    const PrivilegedAppBundleInstallRequest&);

  int runPrivilegedAppBundleHelper(
    std::string helperLabel,
    std::string allowedTeamIdentifier,
    int argc,
    char* argv[]);
}
```

Demo adapter:

- `Demos/AppHub/PrivilegedHelperClient.h` is now a thin demo adapter around label config.
- It has `EACP_APPHUB_EXTERNAL_HELPER` test seam.
- `Demos/AppHub/PrivilegedHelper/Main.mm` calls `eacp::Updater::runPrivilegedAppBundleHelper(...)`.

## Demo App Networking

`Demos/RealUpdateDemo/Main.cpp` was changed to use `eacp/Network/HTTP/Http.h` instead of shelling out to `/usr/bin/curl`.

`Demos/RealUpdateDemo/CMakeLists.txt` links `eacp-network`.

## AppHub Installer Package Work

Changed files:

- `.github/op/tamber-signing.env`
- `README.md`
- `Scripts/lib/macos-signing.mjs`
- `Scripts/package-remote-signed-demo-assets.mjs`
- `Scripts/publish-remote-hub-version.mjs`

### Signing Env

`.github/op/tamber-signing.env` now includes installer signing entries:

```sh
APPLE_INSTALLER_SIGNING_IDENTITY=op://Tamber-Production/ops/APPLE_INSTALLER_SIGNING_IDENTITY
APPLE_INSTALLER_CERTIFICATE_BASE64=op://Tamber-Production/ops/APPLE_INSTALLER_CERTIFICATE_BASE64
APPLE_INSTALLER_CERTIFICATE_PASSWORD=op://Tamber-Production/ops/APPLE_INSTALLER_CERTIFICATE_PASSWORD
```

### Signing Helpers

`Scripts/lib/macos-signing.mjs` now has helpers to:

- Import optional installer certificate into the signing keychain.
- Build a signed component pkg using `productbuild --component <app> /Applications --sign <installer identity>`.
- Verify pkg signatures with `pkgutil --check-signature`.
- Submit pkg files to notarization.
- Staple pkg files.
- Validate stapling.
- Gatekeeper-assess pkg files with `spctl --assess --type install`.

Important correction: installer identity detection now checks `security find-identity -v` without the `codesigning` policy and also falls back to `security find-certificate -c`, because Developer ID Installer certs are not code-signing identities.

### Hub Publish Script

`Scripts/build-and-publish-app.mjs apphub "$VERSION" "$APPHUB_CHANNEL"` dispatches to `Scripts/publish-remote-hub-version.mjs`. This is the local path and the CI path.

`Scripts/publish-remote-hub-version.mjs` now:

- Builds AppHub.
- Signs AppHub helper and app.
- Notarizes/staples AppHub.
- Builds `AppHub-${VERSION}.pkg`.
- Signs the pkg with `APPLE_INSTALLER_SIGNING_IDENTITY`.
- Notarizes/staples the pkg.
- Packages `AppHub-${VERSION}.app.zip`.
- Verifies the packaged app.
- Writes `hub-manifest.json` for app self-update zip.
- Writes `hub-installer.json` for the pkg.
- Uploads app zip, pkg, `hub-manifest.json`, and `hub-installer.json` to the GitHub release.
- Uploads pkg and `hub-installer.json` to the configured bucket channel.

Bucket env conventions match existing generated catalog scripts:

- `APPHUB_STORAGE_ROOT`, default `gs://tamber-artifacts/jamie-updater-demo`
- `APPHUB_PUBLIC_ROOT`, default `https://storage.googleapis.com/tamber-artifacts/jamie-updater-demo`
- `APPHUB_CHANNEL` or `CHANNEL`, default `stable`

Pkg object path:

```text
channels/<safe-channel>/artifacts/AppHub-${VERSION}.pkg
```

Installer manifest object path:

```text
channels/<safe-channel>/hub-installer.json
```

### Full Signed Demo Script

`Scripts/package-remote-signed-demo-assets.mjs` now also:

- Cleans `dist/remote-signed-demo` before creating outputs.
- Builds/signs/notarizes/staples `AppHub-${VERSION}.pkg`.
- Keeps the pkg in `dist/remote-signed-demo`, so the existing CI `gh release upload "$RELEASE_TAG" dist/remote-signed-demo/* --clobber` attaches it to the GitHub release.
- Writes `hub-installer.json`.
- Uploads the pkg and installer manifest to the same bucket channel.

### README

`README.md` now documents the local command:

```sh
op run --env-file=.github/op/tamber-signing.env -- \
  node Scripts/build-and-publish-app.mjs apphub "$VERSION" "$APPHUB_CHANNEL"
```

This is explicitly the same script path CI runs.

## CI

`.github/workflows/publish-remote-signed-demo.yml` already calls:

```sh
node Scripts/build-and-publish-app.mjs apphub "$VERSION" "$APPHUB_CHANNEL"
```

when `publish_hub_update == 'true'`.

For full `include_hub == 'true'`, CI calls:

```sh
node Scripts/package-remote-signed-demo-assets.mjs
```

and then uploads everything in `dist/remote-signed-demo/*` to the GitHub release. Since the pkg and `hub-installer.json` are now in that directory, both are released there too.

## Validation Run

Script syntax:

```sh
for f in Scripts/*.mjs Scripts/lib/*.mjs; do node --check "$f" || exit 1; done
```

Result: passed.

Build:

```sh
cmake --build build-apps-check --target AppHub RealUpdateDemo
```

Result: passed.

Tests:

```sh
ctest --test-dir build-apps-check --output-on-failure
```

Result:

- `UpdaterTests` passed.
- `HubTests` passed.
- `AppHubTests` passed.
- 3/3 tests passed.

## Not Run

The actual signing/notarization/upload flow was not run locally because it requires:

- Apple Developer ID Application cert.
- Apple Developer ID Installer cert.
- Apple notarization credentials.
- GitHub release credentials.
- `gcloud` auth for the target bucket.

## Current Git Status At Last Check

Modified files:

```text
 M .github/op/tamber-signing.env
 M README.md
 M Scripts/lib/macos-signing.mjs
 M Scripts/package-remote-signed-demo-assets.mjs
 M Scripts/publish-remote-hub-version.mjs
```

## Caveats / Next Checks

- Ensure 1Password item `Tamber-Production/ops` has:
  - `APPLE_INSTALLER_SIGNING_IDENTITY`
  - `APPLE_INSTALLER_CERTIFICATE_BASE64`
  - `APPLE_INSTALLER_CERTIFICATE_PASSWORD`
- Ensure CI has bucket auth for `gcloud storage cp`; existing generated catalog scripts already assume `gcloud` is available/authenticated.
- If canonical CPM fetch is needed, run with network access. Previous fresh CPM fetch attempts timed out in this environment.
