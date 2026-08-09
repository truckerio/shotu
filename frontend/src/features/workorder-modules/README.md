# Workorder modules

Each folder owns one workorder capability. Its `manifest.js` declares the stable
policy key, navigation route, ordering, compact placement, and any temporary
grouping with an existing page. Components, hooks, models, styles, and focused
tests for that capability belong beside the manifest.

`workorder-module-registry.js` is the frontend runtime adapter. It consumes the
canonical access modes, module catalog, surfaces, and role defaults from
`shared/workorder-modules.js`; frontend manifests contain presentation metadata
only. Do not add role defaults to the registry.

Normal detail and Create modules render through registry-driven hosts. Those
hosts accept an injected renderer catalog, so adding a normal module does not
require a page-level route or renderer switch.

Preview is intentionally declared as a `supporting` placement in its owner
manifest. This keeps the same owned PreviewPane available for embedded,
fullscreen, and print surfaces while the registry still owns Preview routing,
order, visibility, and access. Role pages may provide chrome and portal
placement, but they must not invent module policy.

To add or move a module:

1. Add or update its canonical entry in `shared/workorder-modules.js`.
2. Add a manifest and owned implementation folder here.
3. Register the manifest in `workorder-module-registry.js`.
4. Add server authorization for every read and mutation.
5. Add role, user-override, route fallback, read-only, and write tests.

Unknown modules and unsupported surfaces resolve to hidden. A frontend route or
hidden control is never a replacement for server authorization.
