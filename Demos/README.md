# Demos

These are consumers of the updater libraries, not library code.

- `AppHub` shows how to build a hub app by configuring and presenting the
  opinionated `eacp-apphub` runtime.
- `HelloWorldDemo` shows how a product app can be packaged and updated by a hub.

Use these as templates for product-specific hub apps. Keep reusable update
primitives in `Lib/`; keep product branding, UI, signing identities, bundle IDs,
and demo manifests here or in downstream applications.
