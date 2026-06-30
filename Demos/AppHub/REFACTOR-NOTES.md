# Pulling AppHub into the library (esp. the privileged installer)

Goal: liberate the reusable parts of `Demos/AppHub` into `eacp` libraries so
the same machinery — above all the privileged installer — can be reused by
`tamber-web/apps/shell` (`TamberShell`), which is the same domain: a resident
menu-bar updater.

## The current split

`eacp::Updater` (the library) is already clean and portable: the data model
(catalog / receipts / manifests / plans), version comparison, dependency
planning, JSON, the privileged-side `installAppBundleArtifact`, and the
user-space `MockPrivilegedHelper`. No Cocoa, no networking. Good foundation.

Everything else lives in the **app** and is what we want to liberate:

- **`AppHubApi.h`** (~1300 lines) — the orchestrator. It conflates six unrelated
  jobs: a state machine, *dev fixture* catalog generation (`writeDevCatalog`,
  maze/teapot ids), remote catalog/manifest fetching, chunked downloads with
  progress, plan staging + execution, the privileged-helper call, receipt
  writing, app launch / run-state — and the Miro bridge `reflect()` on top.
- **`PrivilegedHelperClient-macOS.mm`** — SMJobBless bless + XPC invoke. The
  actual "privileged installer" client.
- **`PrivilegedHelper/Main.mm`** — the root daemon: an XPC listener that
  dispatches one JSON command to `installAppBundleArtifact`.
- **`AppHubPlatform.mm`** — a mix of genuinely generic primitives and
  AppHub-specific paths.
- **CMake** — embeds the helper into `Contents/Library/LaunchServices`,
  configures three plists, sets signing requirements.

The shell (`TamberShell`) is *the same domain* — a resident menu-bar updater —
already linking `eacp-graphics` / `eacp-webview`. It just lacks all the
privileged-install machinery, which is exactly what's trapped in the app.

## The refactors, in priority order

### 1. Extract the privileged installer into `eacp-privileged-helper` (the focus)

The XPC protocol is currently declared inline in *three* places and pinned to
AppHub by two macros (`EACP_APPHUB_HELPER_LABEL`, allowed team id). The whole
mechanism is generic — only the service name, team id, and command set are
app-specific. Carve out a small Cocoa library exposing:

- one shared protocol header (declared once);
- client side: `bless(label, signingRequirement)` wrapping Authorization +
  SMJobBless, and `invoke(serviceName, command, payloadJson) -> replyJson` with
  the semaphore / timeout / invalidation handling that's currently copy-pasted;
- helper side: `runHelperService(serviceName, dispatchFn)` — so a helper `main`
  becomes "register handlers, run," and the boilerplate listener / delegate /
  exception-wrapping disappears.

The key abstraction that makes this reusable *and* testable is an **`Installer`
interface**:

```
installAppBundle(PrivilegedAppBundleInstallRequest) -> InstallResult
submit(InstallPlan) -> InstallResult
```

with two implementations — `MockInstaller` (the existing `MockPrivilegedHelper`,
user-space) and `PrivilegedHelperInstaller` (bless + XPC). `executeInstallPlan`'s
current `if app-bundle → helper else → mock` branch collapses into "engine holds
an `Installer&`." The shell picks the privileged one; tests pick the mock.

### 2. Extract a UI-free `Updater::Engine` from `AppHubApi`

Pull the orchestration — catalog load (local + remote), receipts, plan, staged
download, execute via `Installer`, write receipt, run-state — into an engine that
reports progress through a **callback/observer** (`std::function<void(Operation)>`)
instead of publishing a Miro event directly, and that does no thread marshalling
(the host decides). Then:

- AppHub's Miro API becomes a thin adapter: bind the callback to
  `hubState.publish`, keep `reflect()`.
- TamberShell binds the same callback to its tray + existing `web/` progress UI.

Leave behind in the app: the `reflect()` bridge, and crucially the **dev-fixture
catalog generation** (maze/teapot / `writeDevCatalog` / `publishMockUpdate` /
`resetMock`). That's demo scaffolding, not product — it should not enter the
library (or at most go into a clearly separate `Updater::DevFixtures`).

### 3. Promote the genuinely-generic platform primitives

Move out of `AppHubPlatform` into Core/Graphics: `createAppBundleZip` / unzip
(ditto archive), `openAppBundle` / `openNewAppBundleInstance` (launch another
bundle), `currentExecutablePath`, and a parametrized
`applicationSupportDir(vendor, app)` to replace the hardcoded `defaultStateRoot`.
The AppHub-specific bundle names stay in the app.

### 4. A `eacp_add_privileged_helper(...)` CMake function

This is more than convenience — it's a *correctness* fix. SMJobBless requires the
host app's `SMPrivilegedExecutables` and the helper's `SMAuthorizedClients` to
reference each other's signing requirements. Today that cross-reference is
hand-maintained across three `.plist.in` files and two cache vars. A function
taking `LABEL`, `TEAM_ID`, `SIGNING_REQUIREMENT` and generating both sides from
one source removes a whole class of "bless silently fails" bugs — and is the
single biggest thing standing between the shell and a working privileged install.

## How the shell consumes it

`tamber_shell` adds `eacp-privileged-helper` + the engine to its link line, calls
`eacp_add_privileged_helper(TamberHelper LABEL com.tamber... TEAM_ID ...)` in its
CMake, constructs `PrivilegedHelperInstaller{label}`, hands it to the `Engine`,
and binds progress to its tray / window. No Miro, no demo catalog.

## Watch out for

- **Team id / signing requirement are deployment-specific.** AppHub's
  `MBHR5VAUVQ` must become CMake parameters, never library constants — Tamber's
  identity differs.
- **`eacp-updater` must stay Cocoa-free.** The engine pulls in `eacp-network` /
  Process / filesystem; the privileged client pulls in ServiceManagement /
  Security / XPC. Keep those as a separate Cocoa module so non-mac / portable
  builds of the pure updater survive.
- **Command protocol versioning.** Generalizing the helper's single
  `"installAppBundle"` dispatcher means the shell will want `removeAppBundle` /
  `installComponent` — worth a thin typed command registry now rather than
  string-matching later.
- **Threading boundary.** Keep the engine synchronous-callback only; AppHub's
  `callAsync` / worker-thread choices stay in the host. The shell has its own
  message-thread / `OwningPointer<Impl>` model and shouldn't inherit AppHub's.

## Highest-leverage slice

Item 1 (the `eacp-privileged-helper` extraction with the `Installer` interface)
plus item 4 (the CMake function) directly unblock the shell. Do those first.
