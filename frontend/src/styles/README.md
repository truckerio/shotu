# Global CSS ownership

`../styles.css` is the single application-level CSS entry point. Its imports are
ordered to preserve the historical cascade and must stay in that order unless a
visual regression pass proves otherwise.

- `foundation.css`: design tokens, reset rules, page canvas, and base typography.
- `legacy-workspaces.css`: shared operational selectors that predate feature-owned styles. Do not add new feature CSS here.
- `responsive-overlays.css`: existing shared responsive, modal, preview, and overlay rules.
- `mechanic-detail.css`: transitional mechanic-detail rules awaiting feature-local ownership.
- `create-workorder.css`: shared create-workorder composition rules.
- `workorder-detail.css`: shared workorder object/detail composition and responsive behavior.
- `print.css`: browser print visibility rules.

New component or feature styles belong beside their owning JSX. Only reset,
tokens, application shell, and genuinely cross-feature composition should be
added under this directory.

The compatibility declarations in `../styles.css` mirror imported rules for
source-level regression tests that intentionally read the entry file directly.
