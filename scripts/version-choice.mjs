// Pure helpers for scripts/release.mjs: version arithmetic, the changelog-driven
// suggestion and the answer to the selection prompt. No I/O here, so the
// decisions that actually pick the version are unit-testable.

export function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

export function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // A prerelease sorts before its release: 1.0.0-rc.1 < 1.0.0
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (!a.prerelease && !b.prerelease) return 0;
  return a.prerelease.localeCompare(b.prerelease);
}

export const KINDS = ["patch", "minor", "major"];

export const KIND_LABELS = {
  patch: "Patch — fixes only",
  minor: "Minor — new features, also breaking changes below 0.x",
  major: "Major — incompatible",
};

export function bumpVersion(version, kind) {
  const v = parseSemver(version);
  if (!v) throw new Error(`not a semver version: ${version}`);
  // 0.1.6-rc.1 -> 0.1.6 is the release the prerelease was heading for.
  if (v.prerelease && kind === "patch")
    return `${v.major}.${v.minor}.${v.patch}`;
  if (kind === "patch") return `${v.major}.${v.minor}.${v.patch + 1}`;
  if (kind === "minor") return `${v.major}.${v.minor + 1}.0`;
  return `${v.major + 1}.0.0`;
}

export function buildCandidates(current) {
  return KINDS.map((kind) => ({
    kind,
    version: bumpVersion(current, kind),
    label: KIND_LABELS[kind],
  }));
}

/**
 * The versions to offer for this release.
 *
 * Candidates are derived from `current`, which is what `package.json` says, but
 * that value can be ahead of the registry: a release that was prepared and never
 * published leaves `package.json` at a version npm has never seen. Releasing
 * that exact version is then the obvious choice, and it is offered first.
 */
export function buildReleaseCandidates(current, publishedLatest) {
  const ahead =
    publishedLatest != null &&
    compareSemver(parseSemver(current), parseSemver(publishedLatest)) > 0;

  const candidates = ahead
    ? [
        {
          kind: "prepared",
          version: current,
          label: `already in package.json, never published (npm has ${publishedLatest})`,
        },
        ...buildCandidates(current),
      ]
    : buildCandidates(current);

  return { candidates, ahead };
}

/**
 * Which bump the pending changelog entries look like, following the
 * Keep a Changelog section order.
 */
export function suggestKind(current, pending) {
  const v = parseSemver(current);
  if (!v) throw new Error(`not a semver version: ${current}`);
  const sections = [...pending.matchAll(/^###\s+(.+?)\s*$/gm)].map((m) =>
    m[1].toLowerCase(),
  );
  const has = (name) => sections.some((s) => s.includes(name));
  const breaking =
    has("removed") || /\bbreaking\b|\bincompatible\b/i.test(pending);

  // Below 1.0.0 semver treats the minor bump as the breaking one, and so does
  // this package: it is at 0.x and makes no stability promise to break.
  if (breaking) {
    return v.major === 0
      ? { kind: "minor", why: "breaking or removed, package is still 0.x" }
      : { kind: "major", why: "breaking or removed" };
  }
  if (has("added")) return { kind: "minor", why: "new features (### Added)" };
  if (sections.length) {
    return { kind: "patch", why: "only fixes and changes" };
  }
  return { kind: "patch", why: "no named sections, this is a guess" };
}

/**
 * The date of an existing `## [<version>]` heading, or null when the changelog
 * has no section for that version yet.
 */
export function findReleaseSection(changelog, version) {
  // `\]` followed by whitespace or end of line. `\b` does not work here: `]` is
  // not a word character, so there is no boundary between it and the space in
  // "## [0.1.6] - 2026-09-24" and the pattern would never match at all.
  const match = new RegExp(
    `^## \\[${version.replace(/\./g, "\\.")}\\](?=\\s|$)`,
    "m",
  ).exec(changelog);
  return match ? match[0] : null;
}

/** True when the link reference block already defines `[<version>]:`. */
export function hasVersionLink(changelog, version) {
  return new RegExp(`^\\[${version.replace(/\./g, "\\.")}\\]:`, "m").test(
    changelog,
  );
}

/**
 * Turn one answer from the prompt into a decision.
 * Returns {version}, {retry: true} or {abort: reason}.
 */
export function resolveChoice(answer, candidates, recommendedIndex) {
  // A closed stdin (Ctrl+D) is not an empty line, it is the absence of one.
  if (typeof answer !== "string") {
    return { abort: "no answer, stdin closed (Ctrl+D)" };
  }
  const trimmed = answer.trim();
  if (!trimmed) {
    return { version: candidates[recommendedIndex].version };
  }
  const byIndex = Number(trimmed);
  if (
    Number.isInteger(byIndex) &&
    byIndex >= 1 &&
    byIndex <= candidates.length
  ) {
    return { version: candidates[byIndex - 1].version };
  }
  if (parseSemver(trimmed)) return { version: trimmed };
  return { retry: true };
}
