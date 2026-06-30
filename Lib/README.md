# Library Code

This directory is the reusable updater surface.

- `eacp-updater` owns update-domain primitives: products, artifacts, catalogs,
  receipts, manifest parsing, artifact selection, install planning, verification,
  and privileged install requests.
- `eacp-hub` owns hub-oriented helpers: channel indexes, remote/manual catalog
  loading, local catalog cache paths, and fallback selection.
- `eacp-apphub` owns the opinionated hub-app runtime pieces: app-bundle platform
  operations, launch/quit detection, artifact zipping, privileged helper
  blessing, helper IPC, and the reusable privileged helper server loop.

Code in this directory must not depend on the demo AppHub UI, demo product apps,
or release scripts.
