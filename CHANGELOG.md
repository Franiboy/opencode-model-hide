# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version in `package.json` is the single source of truth for what the next
`npm publish` will produce.

`npm run release` moves everything under `## [Unreleased]` verbatim into the new
version's section. Nothing checks that the section actually describes what
changed: a commit that touches `src/` without an entry here is released with no
entry and no warning. Keeping the section current is the author's job.

## [Unreleased]

This release was prepared on 2026-09-24 and then sat committed but unpublished
for five days, so it also carries the tooling work that followed. Nothing from
that first attempt ever reached npm, which is why there is only ever one
published 0.1.6 rather than two.

### Added

- The server plugin writes `model-hide.catalog.json` next to the bridge file,
  giving the TUI selector a model list to work from.
- A `favorite` entry in the bridge file is applied as the default model on
  TUI startup. A model that is hidden or disabled is never used as the
  default, and an explicitly selected model in a running session is left
  alone.
- `MODEL_HIDE_CATALOG_FILE` overrides the catalog location independently of
  `MODEL_HIDE_BRIDGE_FILE`.
- Typecheck (`tsc --noEmit`, strict), Prettier and a Vitest suite covering
  the bridge file parsing, the catalog writer, the persisted default and the
  live reload. CI runs all three on Node 22 and 24 and asserts that the npm
  tarball contains nothing outside `src/`, `README.md`, `LICENSE` and
  `package.json`.
- Dependabot, so a breaking `@opencode/plugin` release surfaces as a red CI
  check on the upgrade PR rather than as a bug report.
- `npm run release` as the only way to publish: it suggests a version from the
  Unreleased section, bumps `package.json` and `package-lock.json` together,
  commits and tags locally, then publishes, and only then pushes. If the
  publish fails it rolls the commit and the tag back, so `main` is never left
  with a release that does not exist on npm.
- A contributing rule in `README.md` and `AGENTS.md`: a change carries its
  `## [Unreleased]` entry in the same pull request that makes it. Nothing
  enforces this, because `npm run release` copies that section verbatim and never
  compares it against what actually changed.

### Changed

- `src/index.ts`: the `Plugin.define()` wrapper is replaced by
  `satisfies Plugin.Plugin`. `Plugin.define` is an identity function at
  runtime, so this changes no behaviour, but it drops the only value import
  from `@opencode/plugin`.

### Removed

- The standalone single-file variant `model-hide.ts` and the section
  documenting it. Installation now always goes through npm. The file was
  never part of the published package (it is not in the `files` list), so
  this changes nothing for existing installs.

Removing `model-hide.ts` also disposes of a real defect: it had silently stayed
on 0.1.5 code while the package was at 0.1.6, with none of the catalog or
favorite handling, and it did not typecheck.

## [0.1.5] - 2026-09-23

### Fixed

- TUI: guard keymap access so a missing or renamed key does not throw.
- Dump the CLI context shape to adapt the selector to `@opencode/plugin`
  2.0.15.

## [0.1.4] - 2026-09-23

### Removed

- The `./probe` export and `src/probe.ts`, which had been added to debug the
  loader but shipped to the registry by mistake.

### Fixed

- Bridge file fix: the watcher reads through `bridgePath()` so
  `MODEL_HIDE_BRIDGE_FILE` is honoured everywhere.
- TUI: tolerate a context dump that is missing fields instead of throwing.

## [0.1.3] - 2026-09-23

Registry-only build. Identical `src/index.ts` and `src/tui.ts` to 0.1.2, still
shipping `src/probe.ts`. There is no matching commit; see the note on
[0.1.1](#011---2026-09-23).

## [0.1.2] - 2026-09-23

Registry-only build. Identical `src/index.ts` and `src/tui.ts` to 0.1.1, still
shipping `src/probe.ts`. There is no matching commit.

## [0.1.1] - 2026-09-23

Registry-only build. Same plugin code as 0.1.4 plus the `src/probe.ts` export
that 0.1.4 removed. There is no matching commit, and no git tag: the code was
published from an uncommitted working tree. `git tag v0.1.1` would point at a
tree that does not contain `src/probe.ts`, so no tag was created.

## [0.1.0] - 2026-09-23

### Added

- First npm release of `@franiboy/opencode-model-hide`, with the server-side
  model filter and the TUI selector.

[Unreleased]: https://github.com/Franiboy/opencode-model-hide/compare/v0.1.5...HEAD
[0.1.6]: https://github.com/Franiboy/opencode-model-hide/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Franiboy/opencode-model-hide/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Franiboy/opencode-model-hide/compare/v0.1.0...v0.1.4
[0.1.3]: https://github.com/Franiboy/opencode-model-hide/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Franiboy/opencode-model-hide/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Franiboy/opencode-model-hide/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Franiboy/opencode-model-hide/releases/tag/v0.1.0
