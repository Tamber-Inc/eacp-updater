# Making AppHub host every eacp app without per-app wiring

Goal: any app under `Apps/` (except AppHub itself) becomes hostable by AppHub —
discoverable, installable, launchable, updatable — by declaring its identity
**once** at CMake registration. No hand-maintained catalogs, no per-app runtime
code in the hub.

## Why this matters now: two hubs, one machinery

tamber-web is breaking its monolith into **N separate `.app` bundles**. That is
exactly the shape this abstraction wants: each de-monolithed app becomes a
catalog product through one registration call, and the **Tamber AppHub** hosts
them the same way the **eacp AppHub** hosts `Maze`/`Teapot`/etc.

So the real requirement is not "AppHub hosts eacp apps" — it is **the
updater/hosting machinery is a deployment-agnostic library with two thin hosts on
top**: the eacp AppHub and the Tamber AppHub. They differ only in:

- **configuration** — team id, bundle-id prefix, feed URL(s), signing
  requirements, vendor/app-support dirs;
- **UI** — each hub's own webview / tray;
- **which apps register** — each repo's `eacp_add_app(...)` calls.

The genericity rule, stated bluntly: **every hardcoded constant in `AppHubApi.h`
today** — `MBHR5VAUVQ`, `com.tamber.AppHub`, the three GitHub URLs, the
`maze`/`teapot` ids, the signing requirements — becomes either (a) a field on a
`HubConfig` the host constructs, or (b) data in the generated catalog. The
library holds **zero** of them. The generated **catalog is the contract** between
the build and the engine; the **engine + privileged installer are libraries**
parameterized by that config struct (this is the `REFACTOR-NOTES.md` direction —
`TamberShell` reuse — generalized).

Hard boundary: public updater/catalog headers stay platform-neutral. macOS,
Windows, codesign, bundle, service, registry, and helper-specific details live
behind platform implementations, host configuration, or build/publish tooling.
Headers may model abstract platform/architecture variants, but they must not
force a host repo like tamber-web to absorb OS-specific installation mechanics.

## Keep the TamberShell publishing model (channels, immutable artifacts, promotion)

TamberShell + `TamberPublish` already solve the publishing/runtime half of this,
and we want the same conceptual model — not a parallel one. The model:

- **Components** are the unit — both apps and binary blobs (`onnxruntime`,
  `ClapModels`, …), each with per-`(platform, arch)` **variants**.
- Publishing is **two orthogonal ops that compose**:
  - **`publish` an artifact** — pack → sha256 → upload to an **immutable**
    content path: `gs://tamber-artifacts/<component>/<version>/<platform>-<arch>.zip`.
  - **`promote`** — upsert one variant into a **channel manifest** (`main.json`,
    `beta.json`, `dev/<name>.json` in `gs://tamber-manifests`). Moves no bytes.
  - `publish` = pack → hash → upload → promote. The **buckets are the source of
    truth**; no CI in between.
- **`version` is a pure, renamable label decoupled from where the bytes live.**
  This is what makes the workflow you want work: publish to a `dev/*` channel, QA
  by pointing a shell at it, then **flip the switch = `promote` the same
  `url`+`sha256` into `main`** — users get the *exact bytes* that were QA'd,
  verified by sha. No rebuild, no re-upload.
- The **consumer** (`stage`/TamberShell) resolves a channel for its host,
  downloads + verifies + unpacks each component into a fixed app-independent
  location, idempotently (unchanged = up-to-date).

### Pre-release access = switch channels, head-only (no version pinning)

Internal/QA/dev users need to run a build a developer published **before it goes
out the door** — and the same for the hub/shell itself. The ergonomic rule is
deliberately minimal: **a client only ever switches to the *head* of a channel.**
No per-component version pinning, no client-side override state, no version-picker
UI. To get a pre-release build, the user switches their hub (or the hub/shell
self-update) to the relevant channel. "Out the door" = `promote` into `main`.
This is exactly TamberShell's tag-file selection (`~/Desktop/tamber-tag.txt`),
surfaced as a channel switcher in the hub UI and applied uniformly to the hub
itself (it's just another component).

**Channels correspond to literal git branches, or to manual publishes** — two
producers:

- **Branch channels** — CI builds a git branch and publishes *all* of that
  branch's components to a channel named for the branch. **Complete by
  construction** (the branch build produces everything), so head-of-channel =
  head-of-branch and it tracks live as CI republishes. A frozen build is a
  tag/release channel, not a branch channel.
- **Manual publishes** — a developer pushes specific one-off/local binaries to a
  channel by hand via `TamberPublish`. This is the only place single-component
  **deltas** arise, and thus the only place **channel inheritance** (a channel
  declaring a `base` parent + overriding one component, resolution falling through
  to the base) would be needed. For branch channels it's unnecessary. Decide
  whether to support inheritance at all, or require manual channels to be cut full
  too.

Per-component `version` is naturally the **git branch/sha** (`app.sh` already
stamps `dev-<shortsha>`); record branch + sha as **provenance** in the manifest
so QA knows exactly what a channel head is.

### eacp and Tamber are the same model with different words

| eacp Updater | TamberShell |
|---|---|
| `Product` | component |
| `ProductArtifact{platform,arch,url,sha256}` | variant |
| `ProductCatalog` | channel manifest |
| `PackageKind::App / Runtime / Model / Blob` | app vs resource component |
| `channel` field (only ever `"stable"`) | first-class channels (`main`/`beta`/`dev/*`) |

The eacp data model is ~90% there. The **gaps** the shell has solved and eacp
hasn't: channels as first-class, the immutable-artifact + `promote` split,
`gs://` storage, and a user-space components install strategy (vs eacp's
privileged Applications install).

### The reconciliation

- **One manifest schema is the contract.** CMake catalog generation,
  `TamberPublish`, and hand-authoring are all just **producers** of that schema;
  eacp AppHub and TamberShell are **consumers**. Generation feeds the dev/local
  channel (file:// urls); release goes through publish/promote to `gs://`.
  **Hand-tuned manifests and manually-uploaded blobs are first-class** — nothing
  downstream cares whether a manifest was generated or hand-written.
- **`gs://` is read via public https** (`https://storage.googleapis.com/...`),
  which the existing fetch already handles — no gs client in the consumer;
  `gcloud` is only for *publisher* writes.
- **Two install strategies behind one `Installer` interface**: privileged
  Applications install (eacp AppHub) vs user-space components dir (TamberShell).
  The host picks; the engine doesn't care. This is the REFACTOR-NOTES `Installer`
  generalized to also cover blob components.

So: generation removes per-app *catalog* wiring (below); the publish/promote
model removes per-release *deployment* wiring. Both feed the same schema.

## What's actually wired per-app today (the problem)

AppHub knows about apps through a `ProductCatalog` (a list of
`Product{id,name,kind,bundleName,version,deps,artifacts}`). That list is
hand-maintained in **three** disconnected places, each with hardcoded identities:

1. **`AppHubApi.h` → `writeDevCatalog`** — hardcodes `maze`/`teapot`/`runtime`/
   `model` ids, and builds zips by *guessing* the build tree
   (`findBuildAppsRoot` walks up looking for `Apps/GPU/Maze/Maze.app`).
2. **`Main.cpp` → `writeDevCatalog`** — a *different* hardcoded set
   (`editor`/`capture`/`runtime`/`model`).
3. **`Scripts/lib/apphub-catalog.mjs`** — hardcodes the same products *again*,
   including `appPath: ['Apps','GPU','Maze','Maze.app']` and `binaryName`.

On top of that, `AppHubApi` has bespoke surface that assumes a fixed product set:
special `demoApp`/`hubApp` fields in `HubState`, three separate feed URLs
(`DEMO_MANIFEST_URL`/`MANIFEST_URL`/`CATALOG_URL`), a hardcoded
`"com.tamber.AppHub"` self-update branch, and commands like `installDemoApp`/
`updateHub`/`launchDemo`/`launchHub`/`publishMockUpdate`/`resetMock` that only
exist because products were enumerated by hand.

Meanwhile each leaf app (`Maze`, `Teapot`, `GUI`, `SVG`, `Camera`…) repeats the
same 5-line bundle boilerplate (`MACOSX_BUNDLE_*` + `eacp_set_gui_subsystem` +
`set_default_target_setting`), declares **no version**, and declares **no
product identity** the hub could consume.

So "adding an app to the hub" today means editing 3 files with copy-pasted
records. That is the wiring to eliminate.

## The core idea: one descriptor at registration → every consumer derives from it

Make the app's CMake registration the **single source of truth**. Each app
declares its hub identity once; the build accumulates those into a generated
catalog; AppHub consumes the catalog generically with zero per-app knowledge.
The `.app` bundle is already the uniform install/launch interface — nothing
per-app is needed at runtime.

### 1. Unify app registration in CMake

Today there are two front doors: bare `add_executable` + boilerplate (native
apps) and `eacp_add_webview_app` (webview apps). Introduce one front door for the
native case, `eacp_add_app(TARGET …)`, wrapping `add_executable` + bundle props +
`eacp_set_gui_subsystem` + `set_default_target_setting`, and have **both** it and
`eacp_add_webview_app` accept the same hub-metadata block:

```
eacp_add_app(Maze
    SOURCES      Main.cpp
    LINK         eacp-gpu
    PRODUCT_ID   com.eacp.maze       # also becomes the bundle id
    NAME         "Maze"
    VERSION      1.0.0               # default ${PROJECT_VERSION}
    DEPENDENCIES shared.onnxruntime shared.clap   # optional
    # HUB_EXCLUDE                    # opt out (Console, AppHub itself)
)
```

The one new behavior both functions share: append a record to a CMake `GLOBAL`
property (`EACP_HUB_APPS`) capturing
`target;productId;name;bundleName;version;kind;deps`. This is the accumulation
point. AppHub passes `HUB_EXCLUDE` (it never hosts itself); CLI-only targets like
`Console` don't register / pass `HUB_EXCLUDE`.

This also collapses the per-app bundle boilerplate — net *less* CMake per app.

### 2. Generation is the *dev/local* producer feeding the channel model

Call one function once after all `add_subdirectory` calls (top of `Apps/` or
root): `eacp_generate_app_catalog()`. It iterates `EACP_HUB_APPS` and, per app,
wires a packaging step that:

- zips `$<TARGET_BUNDLE_DIR:tgt>` → `<productId>-<version>.app.zip`,
- computes sha256,
- emits a per-app manifest record,

then aggregates all of them into a single channel manifest (`ProductCatalog`)
with `file://…` urls — i.e. a **local channel**. This is one producer of the
shared schema; `TamberPublish` (pack → upload `gs://` → promote) is the release
producer, and hand-editing is always allowed. The consumer can't tell them apart.

This **deletes** both `writeDevCatalog` functions and the `findBuildAppsRoot`/
`builtDemoBundle` tree-guessing, and replaces the hardcoded JS map in
`apphub-catalog.mjs`. One generator, fed by registration — adding an app needs no
packaging edits. For release, the generated records are exactly what gets
published/promoted, so there is no second source to keep in sync.

Decide whether eacp reuses `TamberPublish` directly (preferred — one tool, one
bucket convention) or grows a thin equivalent; either way both target the same
manifest schema and the same `gs://artifacts` + `gs://manifests` split.

### 3. Make AppHub runtime fully catalog-driven (remove the special cases)

`installProduct` / `openProduct` / `closeProduct` / `updateAll` / `checkUpdates`
are already generic over `(catalog, receipts, productId)` — keep them. Remove
everything that assumes a fixed product set:

- Drop `demoApp`/`hubApp` from `HubState`; self-update becomes an ordinary
  product flagged `isSelf` (computed: `product.id == currentBundleId()`). The UI
  renders the self-product specially; the data model doesn't special-case it.
- Collapse three feed URLs into **one selected channel** (`main`/`beta`/`dev/*`),
  with a **channel switcher** in the UI (head-only) mirroring TamberShell's
  tag-file selection — this is the pre-release access mechanism, and it applies to
  the hub itself. Delete `installDemoApp`/`updateHub`/`launchDemo`/`launchHub`/
  `publishMockUpdate`/`resetMock` and the hardcoded `"com.tamber.AppHub"` branch —
  artifacts of hand-enumeration.
- Blob/runtime/model products install via the same generic path as apps, just
  with the user-space components `Installer` instead of the privileged one —
  keyed off `PackageKind`, not per-product code.
- Replace installed-version detection via `executable --version` (which assumes
  every app implements that flag) with reading `CFBundleShortVersionString` from
  the installed bundle's Info.plist — uniform, no per-app code, and the version
  is already baked there by step 1.

### 4. Versioning flows one way

`VERSION` from the descriptor feeds `MACOSX_BUNDLE_SHORT_VERSION_STRING` **and**
the generated catalog, so "installed version" (read from Info.plist) and "latest
version" (from catalog) share one origin. No app needs a `--version` handler.

### 5. Alignment with the existing REFACTOR-NOTES

This is consistent with — and partly subsumes — the planned `Updater::Engine` /
`eacp-privileged-helper` extraction. The generated catalog is precisely the
contract between "the build" and "the engine": the engine consumes a
`ProductCatalog`; where it comes from (generated dev catalog vs. remote feed)
stays pluggable. Do the catalog-generation abstraction first since it removes the
per-app wiring; the engine extraction follows and gets a clean input.

## Tamber app / shell wiring contract

The shell integration should be boring to wire and pleasant to operate:

- **Inputs:** a selected channel catalog URL, a hub manifest URL for self-update,
  a state root, and the platform target. The shell should not know per-app zip
  names or hashes; those live in `ProductCatalog`.
- **State:** render `HubState.products` and `HubState.operation`. Product rows
  already carry `installedVersion`, `latestVersion`, `state`, dependencies, and
  bundle names. Operation events carry title/detail/product id and byte progress,
  so the shell can show one progress surface for install, update, and self-update.
- **Commands:** use `installProduct(productId)` for first install/reinstall,
  `updateProduct(productId)` for a deliberate one-app update, `updateAll()` for
  the sweep, `updateHub(manifestUrl)` for self-update, and `openProduct(productId)`
  for launch. The CLI equivalents are `catalog-install <id>`,
  `catalog-update <id>` / `update <id>`, bare `update`, and `update-hub`.
- **Receipts:** installed state is receipt-driven. The shell should not infer
  installation from files in `/Applications`; it should subscribe to or refresh
  `HubState` after commands complete.
- **Host app boundary:** AppHub stays a catalog/updater surface. TamberShell owns
  channel selection, account/session policy, and app-specific presentation. The
  updater code composes cleanly because it only needs a catalog source, a state
  root, and command calls.

That means a Tamber shell MVP can be a thin adapter:

1. Construct or embed the AppHub backend with Tamber's channel URLs and state root.
2. Render catalog products from `HubState`.
3. Wire row buttons directly to `installProduct`, `updateProduct`, `openProduct`,
   and bulk toolbar actions to `checkUpdates` / `updateAll`.
4. Use `HubState.operation` for the global progress indicator and toast/result
   text.

## Suggested sequencing

0. Converge the data model: make `channel` first-class in `ProductCatalog`
   (manifest = one channel) and confirm `gs://`-backed public-https urls fetch
   through the existing client. Align eacp's schema field-for-field with the
   TamberShell channel manifest so one consumer reads both.
1. Add hub-metadata args + `EACP_HUB_APPS` accumulation to `eacp_add_webview_app`;
   introduce `eacp_add_app` for native apps. Migrate leaf CMakeLists (mechanical).
2. Write `eacp_generate_app_catalog()` (zip + sha + manifest + aggregate) emitting
   a local channel; point `apphub-catalog.mjs` at it; delete the hardcoded JS map.
   Decide reuse-`TamberPublish` vs thin-equivalent for the `gs://` release path.
3. Gut `writeDevCatalog`/`findBuildAppsRoot` from `AppHubApi.h` and `Main.cpp`;
   load the generated channel manifest instead.
4. Extract a `HubConfig` struct (team id, bundle-id prefix, channel + bucket
   bases, signing requirements, vendor/app-support + components dirs) and push
   every hardcoded constant onto it. eacp AppHub and Tamber AppHub each build one.
5. Generalize `AppHubApi`: catalog-driven self-update flag, single channel,
   Info.plist version detection, `PackageKind`-keyed installer selection, remove
   demo/hub-specific commands and fields.
6. (Follow-on) Extract `Updater::Engine` + the `Installer` interface (privileged
   + user-space-components impls) + `eacp-privileged-helper` per REFACTOR-NOTES,
   all parameterized by `HubConfig`, fed by a channel manifest. At this point the
   Tamber AppHub is: link the libraries, construct a `HubConfig`, register its
   apps, ship its UI — and `publish`/`promote` drives QA → prod by flipping a
   channel, no rebuild.

## Decisions worth making explicitly

- **Runtimes/models/blobs** (`shared.onnxruntime`, `shared.clap`, the Tamber
  model components) aren't apps under `Apps/` — they're components whose bytes
  come from elsewhere. They enter the same channel manifest either via a parallel
  `eacp_register_blob(...)` (generated) or via hand-authored manifests +
  `gs://` uploads (the TamberShell path today). Both must stay supported; decide
  which is the default for eacp's own blobs.
- **Which apps opt in.** ~25 leaf apps exist; many are tiny demos. Either "all
  GUI-bundle apps register unless `HUB_EXCLUDE`" (auto, closer to "host ALL
  apps") or "opt-in only via explicit `PRODUCT_ID`" (safer). Pick one. The same
  registration mechanism must work unchanged in tamber-web, so prefer a rule that
  travels across repos rather than one tuned to this tree.
- **Reuse `TamberPublish` or fork it.** Preferred: one tool, one bucket
  convention, both repos publish/promote through it. The alternative (a thin eacp
  equivalent) duplicates the immutable-artifact + promote logic — only worth it if
  eacp must publish without the tamber-web toolchain present.
- **Where the install strategy is decided.** Apps → privileged Applications
  install; blobs → user-space components dir. Confirm this is purely a
  `PackageKind` → `Installer` mapping in `HubConfig`, with no product ever naming
  its own installer.
- **Channel inheritance — needed at all?** Branch channels are complete by
  construction (CI publishes the whole branch build), so inheritance only matters
  for *manual* single-component publishes. Decide: support a `base`/parent +
  fall-through resolution (lets a manual channel be `main + one app`), or require
  even manual channels to be cut full. Settle before building the resolver — it
  changes manifest shape and resolution.
- **Provenance in the manifest.** Record git branch + sha (and build time) per
  component so a channel head is traceable to a commit. Cheap to add to the schema
  now; painful to retrofit. Confirm the version label convention (`dev-<sha>` vs
  semver) at the same time.
- **Branch → channel naming + lifecycle.** If channels mirror branches, decide
  the naming map (`<branch>` vs `dev/<branch>`), who creates/deletes them, and
  what happens to a channel when its branch merges or is deleted (garbage
  collection of stale channels/artifacts).
