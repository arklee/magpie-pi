# Monorepo guidelines

- Independently version and publish packages under `packages/`; the root is private.
- Read the package's AGENTS.md, README.md and PLAN.md before changing it.
- Preserve package-specific runtime, licensing and upstream provenance boundaries.
- Do not introduce shared libraries until multiple packages have a concrete need.
- Keep credentials, user state, node_modules and build outputs out of commits.
- Do not publish, push, or modify global Pi settings unless requested.
- Root `npm run build`, `npm test`, `npm run typecheck` and `npm run check`
  delegate to workspace scripts. Use `npm run check --workspace magpie-pi`
  for that package's full validation.
- Run package-local scripts from their package directory, or via npm workspace
  commands; Go modules and Bun fixtures remain package-local.
- Keep user READMEs focused on installation and usage. Development and release
  details belong in package docs.
- Releases are independent; use tags such as `magpie-pi/v0.1.2`. Never publish
  the workspace root or bump unrelated package versions.
