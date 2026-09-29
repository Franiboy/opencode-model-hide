# AGENTS.md — opencode-model-hide

npm package `@franiboy/opencode-model-hide`: an OpenCode plugin that hides models
from the picker and manages the selection through a TUI dialog. Public
repository, public npm registry.

## Layout

```
src/index.ts   Server plugin (read the bridge file, filter models, write the catalog)
src/tui.ts     TUI selector, loaded from the server plugin
scripts/       release.mjs and the pure version-choice helpers
tests/         Vitest; boots the real plugin entrypoint against a minimal ctx
```

The package ships raw TypeScript (`exports` points at `./src/index.ts`). There is
no build step and no `dist/`. `model-hide.ts`, the single-file variant, was
removed on 2026-09-29: installation always goes through npm.

## Commands

```bash
npm ci
npm run check                  # format:check + typecheck + test, this is the CI condition
npm run format                 # prettier --write .
npm run release                # asks which version to release, then releases it
npm run release -- 0.1.7       # same, with the version already decided
npm run release -- 0.1.7 --dry-run
```

After every change to `src/`, `npm run check` must be green. The typecheck runs
`strict` against the resolved `@opencode/plugin`; that is where its value lies,
because a breaking change in the plugin API shows up there.

## Release

`npm run release` is the only way to publish. Without an explicit version it
reads the `## [Unreleased]` section of `CHANGELOG.md`, suggests a bump from the
sections used there, and asks which version to release. The order of operations
is a transaction and not up for negotiation:

1. Checks — on `main`, clean tree, `main` identical to `origin/main`, version
   greater than the current one, not already on npm, CI green on HEAD, `npm run check`.
2. `CHANGELOG.md`: `## [Unreleased]` becomes `## [<version>] - <date>`.
3. `npm version --no-git-tag-version` — bumps `package.json` **and** `package-lock.json`.
4. Commit `Release v<x.y.z>` and annotated tag `v<x.y.z>`, still local.
5. `npm publish`.
6. Only now the push: first `main`, then the tag.

Why the publish comes **before** the push: the failure this package already had
once was a version committed and tagged but never published (0.1.6 sat in that
state for days). A commit that has not left `main` can be rolled back, a remote
tag cannot. If `npm publish` fails, the script runs `git reset --hard` and
deletes the tag — `main` is left exactly as it was, nothing was pushed. **Do
not** run `npm publish` by hand and then walk away; that is what produces the
half-finished state.

The release commit is made directly on `main` and skips review on purpose: it
is mechanical (version bump, lockfile, changelog) and comes from the
script-checked state. Code changes still go through a PR.

### The conditions under which the script fails, all of them deliberate

- npm has 2FA on writes. `npm publish` prints a URL that has to be confirmed in
  a browser. An automation token would avoid that but none is configured.

  That URL only works when `npm publish` runs with both stdin and stdout
  attached to a terminal. npm starts the browser flow only under that condition
  and masks the URL otherwise, printing `auth/cli/***` — see
  `lib/utils/auth.js`: `if (!process.stdin.isTTY || !process.stdout.isTTY)
throw err`. Never capture the publish output; the script inherits stdio for
  exactly this reason.

- A missing `## [Unreleased]` section in the changelog aborts the release. Write
  the notes first, release second. An _empty_ section is allowed, because a
  Dependabot bump has nothing to announce.
- Without a terminal the script cannot ask and says so instead of hanging.
- `gh` writes API error bodies to **stdout**. The script therefore checks the
  exit status _and_ the shape of the response, and does not treat an empty list
  of checks as green.
- `readline`'s promise form resolves with `undefined` on Node 24.19 before any
  input arrives, so the prompt uses the callback form.

## Git tags

`v0.1.1`, `v0.1.2` and `v0.1.3` are missing on purpose and must not be invented
afterwards. Those three registry versions have byte-identical `src/`, but they
additionally shipped a `src/probe.ts` that exists in **no** commit. A tag on
`0c1e0e8` would claim a tree that does not contain that file. `v0.1.4` and
`v0.1.5` are byte-reproducible and are tagged.

Tags are created by the release script alone. Adding one retroactively is only
allowed when the published content can be reproduced from a commit byte for byte.

## Runtime files

| File                                         | Purpose                                        |
| -------------------------------------------- | ---------------------------------------------- |
| `~/.config/opencode/model-hide.json`         | Bridge: `hidden: string[]`, `favorite: string` |
| `~/.config/opencode/model-hide.catalog.json` | written by the server plugin, read by the TUI  |

`MODEL_HIDE_BRIDGE_FILE` and `MODEL_HIDE_CATALOG_FILE` override both paths.
Neither file may ever be committed or included in the tarball — the `pack` job
in CI checks that the npm tarball holds nothing beyond `src/`, `README.md`,
`LICENSE` and `package.json`.

## CI

`.github/workflows/ci.yml`, two jobs: `check` on Node 22 and 24 (Prettier,
typecheck, Vitest) and `pack` (tarball contents). Dependabot reports
`@opencode/plugin` separately from the other devDependencies, because a break
there turns CI red.

`main` is protected by branch protection (legacy endpoint, not a ruleset):
a pull request with **one approving review**, the last pusher not being able to
approve their own commit, stale reviews dismissed on every new push, all three
CI checks green and up to date with `main`, and no unresolved conversation.
Force pushes and branch deletion are off.

Squash is the **only** merge method: `allow_merge_commit` and
`allow_rebase_merge` are disabled at the repository level and
`delete_branch_on_merge` is on, so a merged pull request is squashed and its
head branch disappears. The older merge commits in the history predate that
setting and are not a reason to re-enable it. Note that `allowed_merge_methods`
is silently ignored by this endpoint — it reads back `null` whatever is sent —
so the merge method is governed by the repository settings above, not by
branch protection.

**Administrators bypass all of it** (`enforce_admins` is off). That is not an
oversight, it is the load-bearing part: `npm run release` commits on `main` and
pushes it _after_ `npm publish`, so a hard block on that push would fail with
the version already live on npm and no commit on the remote. The bypass is what
keeps the ordering in "Release" safe. `Franiboy` is the only collaborator and the
only admin, so "bypass" means the release script and nothing else. If a second
admin is ever added, the bypass stops being narrow and this reasoning expires.

Release tags are **not** protected. Tag protection only exists through rulesets,
and creating a ruleset on this repository answers `404 Not Found` while reading
them answers `[]`, so the plan does not expose the endpoint. Tags therefore rely
on the account not pushing them by accident.

Even with the bypass, still **ask before merging**, do not merge unprompted.
Opening and pushing PRs is fine.

## Every PR documents its change

A pull request that changes behaviour carries an entry under `## [Unreleased]`
in `CHANGELOG.md`, written **in that same PR**. Not at release time, not in a
follow-up — in the change itself.

Place it under the Keep a Changelog heading that fits: `Added`, `Changed`,
`Fixed`, `Removed`. Those headings are also what `npm run release` reads to
suggest a version, so the section is not only prose, it decides whether the next
release is a patch or a minor.

Entries describe what a user would notice, not which files were touched. "The
bridge file is re-read after a malformed write" is useful; "`src/index.ts` changed"
is not. Say what changed and, where it is not obvious, why.

## The changelog is not verified, it is trusted

`npm run release` moves the text under `## [Unreleased]` verbatim into the new
version's section. That is the whole mechanism — it is a text substitution, not
a check.

Verified by injecting a behaviour change into `src/index.ts` with no changelog
entry: format, typecheck and all 46 tests stayed green, and the release ran to
completion without a word about the undocumented change. The commit that shipped
it would have had no changelog entry at all.

So the rule above is a discipline, not a guarantee. Nothing downstream will catch
a forgotten entry, which is exactly why it belongs in the change rather than in a
remembered checklist at release time.

## Failure modes that have already bitten here

- A hand bump in `package.json` without a publish — the reason for 0.1.6. The
  release script is the answer to that.
- A hand-maintained duplicate of `src/index.ts` (`model-hide.ts`) that silently
  stayed on 0.1.5 code while the package was at 0.1.6, and that did not even pass
  the typecheck. It was removed rather than kept in sync.
- Tests that never fail are worthless. The three guards in
  `tests/plugin.test.ts` (hidden favorite, disabled models, no rewrite of an
  unchanged catalog) were each verified to fail by removing the corresponding
  condition. New tests owe the same.
