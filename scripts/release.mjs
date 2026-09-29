#!/usr/bin/env node
// One transaction: bump -> changelog -> commit -> tag -> publish -> push.
//
//   node scripts/release.mjs 0.1.7
//   node scripts/release.mjs 0.1.7 --dry-run
//   node scripts/release.mjs 0.1.7 --skip-ci
//
// The order matters and is the whole point of this script. Publish happens
// BEFORE the push, because the failure this package already had once was a
// version committed and tagged but never published (0.1.6 sat at that state
// for days). A tag on the remote is the last thing to happen, so a tag never
// claims a release that does not exist on npm.
//
// If `npm publish` fails - and it will ask for a one-time password, because
// the npm account has 2FA on writes - the commit and the tag are rolled back
// and main is left exactly as it was.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import url from "node:url";
import {
  buildCandidates,
  compareSemver,
  parseSemver,
  resolveChoice,
  suggestKind,
} from "./version-choice.mjs";

const root = path.dirname(
  url.fileURLToPath(new URL("../package.json", import.meta.url)),
);
const PKG_NAME = "@franiboy/opencode-model-hide";
const REPO = "Franiboy/opencode-model-hide";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const dryRun = flags.has("--dry-run");
const skipCi = flags.has("--skip-ci");

function die(message, code = 1) {
  console.error(`\nrelease: ${message}\n`);
  process.exit(code);
}

function step(message) {
  console.log(`\n==> ${message}`);
}

function run(command, commandArgs, options = {}) {
  const res = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (res.error) die(`${command} could not be started: ${res.error.message}`);
  if (res.status !== 0 && !options.allowFailure) {
    if (options.capture) {
      console.error(res.stdout ?? "");
      console.error(res.stderr ?? "");
    }
    die(`${command} ${commandArgs.join(" ")} failed with exit ${res.status}`);
  }
  return res;
}

function capture(command, commandArgs) {
  return run(command, commandArgs, { capture: true, allowFailure: true });
}

function parseSemverOrDie(version, label) {
  const parsed = parseSemver(version);
  if (!parsed) die(`${label} "${version}" is not a plain semver version`);
  return parsed;
}

// ---------------------------------------------------------------- arguments

const [requested] = positional;
const unknown = [...flags].filter(
  (f) => !["--dry-run", "--skip-ci"].includes(f),
);
if (unknown.length) die(`unknown flag(s): ${unknown.join(", ")}`);
if (positional.length > 1) {
  die(`expected at most one version, got: ${positional.join(", ")}`);
}

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const current = pkg.version;
const currentSemver = parseSemverOrDie(current, "package.json version");

// ------------------------------------------------------- changelog (read early)

// Read before anything else: the Unreleased section is both the source for the
// version suggestions and a hard precondition, so a missing one should fail
// before the user is asked to pick anything.
const changelogPath = path.join(root, "CHANGELOG.md");
const changelog = fs.readFileSync(changelogPath, "utf8");
const unreleasedHeading = /^## \[Unreleased\][ \t]*$/m;
if (!unreleasedHeading.test(changelog)) {
  die(
    "CHANGELOG.md has no `## [Unreleased]` section.\n" +
      "     Write the release notes there first, then run the release.",
  );
}
const body = changelog.slice(
  changelog.indexOf("## [Unreleased]") + "## [Unreleased]".length,
);
const pending = body
  .split(/^## /m)[0]
  .replace(/^\s*\[.*?\]:.*$/gm, "")
  .trim();
if (!pending) {
  // Not fatal: a Dependabot bump has nothing to announce, and refusing those
  // would make dependency updates unreleasable.
  console.log(
    "\n  note: the Unreleased section is empty, so the suggestion below is a guess.",
  );
}

// --------------------------------------------------------------- suggestions

async function chooseVersion() {
  const suggested = suggestKind(current, pending);
  const candidates = buildCandidates(current);
  const recommendedIndex = candidates.findIndex(
    (c) => c.kind === suggested.kind,
  );

  console.log(`\n  ${PKG_NAME} is at ${current}.\n`);
  console.log(`  From CHANGELOG.md: ${suggested.why}\n`);
  for (const [i, candidate] of candidates.entries()) {
    const mark = candidate.kind === suggested.kind ? "  <- suggested" : "";
    console.log(
      `    ${i + 1})  ${candidate.version.padEnd(9)} ${candidate.label}${mark}`,
    );
  }

  // Without a terminal there is nobody to answer, and readline on a closed
  // stdin would either hang or resolve to undefined. Fail instead.
  if (!process.stdin.isTTY) {
    console.log("");
    die(
      "no version given and stdin is not a terminal, cannot ask.\n" +
        `     Run it interactively, or pass one: npm run release -- ${candidates[recommendedIndex].version}`,
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  // The callback form, not the promise form: on Node 24.19 the promise form
  // resolves with undefined before any input has arrived.
  const ask = (promptText) =>
    new Promise((resolve) => rl.question(promptText, resolve));

  try {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const answer = await ask(
        `\n  Choice [1-${candidates.length}, Enter = ${recommendedIndex + 1}, or type a version]: `,
      );
      const choice = resolveChoice(answer, candidates, recommendedIndex);
      if (choice.version) return choice.version;
      if (choice.abort) die(choice.abort);
      console.log(
        `  "${String(answer).trim()}" is neither a choice nor a version.`,
      );
    }
  } finally {
    rl.close();
  }
  die("too many invalid answers, aborting");
}

const next = requested ?? (await chooseVersion());
const nextSemver = parseSemverOrDie(next, "version");

if (compareSemver(nextSemver, currentSemver) <= 0) {
  die(`version ${next} must be greater than the current ${current}`);
}

// ---------------------------------------------------------- repository state

step(`release ${current} -> ${next} of ${PKG_NAME}`);

const branch = capture("git", [
  "rev-parse",
  "--abbrev-ref",
  "HEAD",
]).stdout.trim();
if (branch !== "main") die(`must run on main, not ${branch}`);

const dirty = capture("git", ["status", "--porcelain"]).stdout.trim();
if (dirty) {
  console.error(dirty);
  die("working tree is not clean");
}

const headBefore = capture("git", ["rev-parse", "HEAD"]).stdout.trim();

capture("git", ["fetch", "--quiet", "origin", "main"]);
const remoteMain = capture("git", ["rev-parse", "origin/main"]).stdout.trim();
if (remoteMain !== headBefore) {
  die(
    `main is not in sync with origin/main (local ${headBefore.slice(0, 7)}, ` +
      `remote ${remoteMain.slice(0, 7)}). Pull first.`,
  );
}

if (capture("git", ["tag", "-l", `v${next}`]).stdout.trim()) {
  die(`tag v${next} already exists`);
}

const latestTag = capture("git", ["tag", "--list", "v*", "--sort=-v:refname"])
  .stdout.split("\n")
  .filter(Boolean)[0];

// ------------------------------------------------------------------- npm side

step("npm registry");
const view = capture("npm", ["view", PKG_NAME, "versions", "--json"]);
if (view.status !== 0) {
  console.error(view.stdout ?? "");
  console.error(view.stderr ?? "");
  die("could not read the published versions from npm");
}
let published;
try {
  published = JSON.parse(view.stdout);
} catch {
  // npm answers `null` for a package with no versions at all
  published = [];
}
if (published.includes(next)) die(`${next} is already published on npm`);

console.log(
  `  published: ${published.length} version(s), latest tag ${
    capture("npm", ["view", PKG_NAME, "dist-tags.latest"]).stdout.trim() ||
    "(none)"
  }`,
);
console.log(`  new:       ${next}`);

// --------------------------------------------------------------------- CI gate

if (skipCi) {
  console.log("\n==> SKIPPING the CI check (--skip-ci)");
} else {
  step("CI on HEAD");
  const checks = capture("gh", [
    "api",
    `repos/${REPO}/commits/${headBefore}/check-runs`,
    "--paginate",
    "--jq",
    "[.check_runs[] | [.name, .status, .conclusion]] | .[] | @tsv",
  ]);
  if (checks.status !== 0) {
    console.error(checks.stderr ?? "");
    die("could not read the check runs; refusing to guess whether CI passed");
  }
  const rows = checks.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t"));
  // An empty answer is not a success: gh writes API error bodies to stdout.
  if (!rows.length)
    die("no check runs reported for HEAD; not treating that as green");
  const bad = rows.filter(
    ([, status, conclusion]) =>
      status !== "completed" || conclusion !== "success",
  );
  for (const [name, status, conclusion] of rows) {
    console.log(
      `  ${conclusion === "success" ? "ok  " : "FAIL"} ${name} (${status}/${conclusion})`,
    );
  }
  if (bad.length) die(`${bad.length} check(s) not successful on HEAD`);
}

// ----------------------------------------------------------------- local gates

step("local checks");
run("npm", ["run", "check"]);

// ------------------------------------------------------------------- changelog

step("changelog");
const today = new Date().toISOString().slice(0, 10);
const previous = latestTag?.replace(/^v/, "") ?? current;
// Only horizontal whitespace in the pattern above: `\s*$` would swallow the
// blank line between the heading and the body, and the emitted changelog has to
// stay prettier-clean or the release commit lands on a red CI.
let updated = changelog.replace(
  unreleasedHeading,
  `## [Unreleased]\n\n## [${next}] - ${today}`,
);

// Keep the link references truthful: Unreleased now starts at the new tag, and
// the new version gets a link from the previously released one, in the same
// descending order as the entries already there.
const base = `https://github.com/${REPO}/compare`;
updated = updated.replace(
  /^\[Unreleased\]:.*$/m,
  `[Unreleased]: ${base}/v${next}...HEAD\n[${next}]: ${base}/v${previous}...v${next}`,
);
fs.writeFileSync(changelogPath, updated);

// ------------------------------------------------------------------ the bump

step("bump version");
run("npm", ["version", next, "--no-git-tag-version"]);

// ---------------------------------------------------------------- transaction

const TOUCHED = ["package.json", "package-lock.json", "CHANGELOG.md"];

function rollback() {
  console.log("\n==> rolling back commit and tag");
  run("git", ["reset", "--hard", headBefore], { allowFailure: true });
  run("git", ["tag", "-d", `v${next}`], { allowFailure: true });
}

// A dry run must not create a commit in the first place. The previous version
// committed and then reset, which left a release commit behind whenever the
// process died between the two - verified, not theoretical.
if (dryRun) {
  console.log("\n==> dry run: showing what would change, nothing committed");
  console.log("\n--- git diff ---");
  run("git", ["diff", "--", ...TOUCHED]);
  console.log("\n==> restoring the working tree");
  run("git", ["checkout", "--", ...TOUCHED]);
  run("git", ["status", "--short"]);
  console.log(
    `  HEAD is still ${capture("git", ["rev-parse", "--short", "HEAD"]).stdout.trim()}, ` +
      `no commit and no tag were created`,
  );
  process.exit(0);
}

step("commit and tag");
run("git", ["add", ...TOUCHED]);
run("git", ["commit", "-m", `Release v${next}`]);
run("git", ["tag", "-a", `v${next}`, "-m", `${PKG_NAME} v${next}`]);

// Publish before pushing: if this fails, nothing has left the machine.
step(`publish ${next} to npm`);
const publish = capture("npm", ["publish"]);
if (publish.status !== 0) {
  console.error(publish.stdout ?? "");
  console.error(publish.stderr ?? "");
  rollback();
  die(
    "npm publish failed, nothing was pushed. main is unchanged.\n" +
      "     (The npm account has 2FA on writes: open the printed URL, then rerun.)",
  );
}

// The commit first, then the tag: a remote tag must never exist without its
// commit.
step("push");
run("git", ["push", "origin", "main"]);
run("git", ["push", "origin", `v${next}`]);

step("verify");
const latest = capture("npm", [
  "view",
  PKG_NAME,
  "dist-tags.latest",
]).stdout.trim();
if (latest !== next) {
  die(`published, but dist-tags.latest is "${latest}" instead of "${next}"`);
}
console.log(`  npm latest  = ${latest}`);
console.log(
  `  git tag     = ${capture("git", ["rev-parse", "--short", `v${next}^{commit}`]).stdout.trim()}`,
);
console.log(
  `  remote tag  = ${capture("git", ["ls-remote", "--tags", "origin", `v${next}`]).stdout.split("\t")[0]}`,
);
console.log(`\n==> released ${PKG_NAME}@${next}\n`);
