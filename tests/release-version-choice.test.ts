import { describe, expect, it } from "vitest";
import {
  buildCandidates,
  buildReleaseCandidates,
  bumpVersion,
  compareSemver,
  findReleaseSection,
  hasVersionLink,
  parseSemver,
  resolveChoice,
  suggestKind,
} from "../scripts/version-choice.mjs";

// 0.1.6 is the reason these exist: it sat committed but unpublished, which left
// a `## [0.1.6]` section behind. Releasing it again would have written a second
// heading of the same name and a second link reference.
const CHANGELOG = [
  "## [Unreleased]",
  "",
  "### Added",
  "",
  "- something",
  "",
  "## [0.1.6] - 2026-09-24",
  "",
  "### Added",
  "",
  "- the catalog",
  "",
  "[Unreleased]: https://example.test/compare/v0.1.5...HEAD",
  "[0.1.6]: https://example.test/compare/v0.1.5...v0.1.6",
  "[0.1.5]: https://example.test/compare/v0.1.4...v0.1.5",
].join("\n");

describe("findReleaseSection", () => {
  it("finds an existing section for the version", () => {
    expect(findReleaseSection(CHANGELOG, "0.1.6")).toBe("## [0.1.6]");
  });

  it("returns null for a version without a section", () => {
    expect(findReleaseSection(CHANGELOG, "0.2.0")).toBeNull();
  });

  it("does not match a version that is only a prefix of another", () => {
    expect(findReleaseSection(CHANGELOG, "0.1")).toBeNull();
  });

  it("does not confuse a link reference for a section", () => {
    // The link block may already mention a version that never got a heading,
    // for instance after a release that was rolled back.
    const withStrayLink = `${CHANGELOG}\n[0.2.0]: https://example.test/compare/v0.1.6...v0.2.0\n`;
    expect(findReleaseSection(withStrayLink, "0.2.0")).toBeNull();
  });
});

describe("buildReleaseCandidates", () => {
  it("offers a plain bump when package.json matches the registry", () => {
    const { candidates, ahead } = buildReleaseCandidates("0.1.6", "0.1.6");

    expect(ahead).toBe(false);
    expect(candidates.map((c) => c.version)).toEqual([
      "0.1.7",
      "0.2.0",
      "1.0.0",
    ]);
  });

  it("offers the prepared version first when package.json is ahead of npm", () => {
    // The state 0.1.6 sat in: committed locally, never published.
    const { candidates, ahead } = buildReleaseCandidates("0.1.6", "0.1.5");

    expect(ahead).toBe(true);
    expect(candidates[0].version).toBe("0.1.6");
    expect(candidates[0].kind).toBe("prepared");
    expect(candidates.map((c) => c.version)).toEqual([
      "0.1.6",
      "0.1.7",
      "0.2.0",
      "1.0.0",
    ]);
  });

  it("says what is going on in the prepared label", () => {
    const { candidates } = buildReleaseCandidates("0.2.0", "0.1.5");

    expect(candidates[0].label).toContain("0.1.5");
  });

  it("treats an empty registry as no published version", () => {
    const { ahead } = buildReleaseCandidates("0.1.0", null);

    expect(ahead).toBe(false);
  });
});

describe("hasVersionLink", () => {
  it("sees an existing link reference", () => {
    expect(hasVersionLink(CHANGELOG, "0.1.6")).toBe(true);
  });

  it("does not see a missing one", () => {
    expect(hasVersionLink(CHANGELOG, "0.2.0")).toBe(false);
  });
});

// These are the decisions that pick the released version. They are tested here
// because `npm run release` can only be exercised by hand, and only on the
// machine that has the npm credentials.
describe("bumpVersion", () => {
  it("bumps each component", () => {
    expect(bumpVersion("0.1.6", "patch")).toBe("0.1.7");
    expect(bumpVersion("0.1.6", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.6", "major")).toBe("1.0.0");
  });

  it("turns a prerelease into its release", () => {
    expect(bumpVersion("1.2.0-rc.1", "patch")).toBe("1.2.0");
  });

  it("refuses a non-semver input", () => {
    expect(() => bumpVersion("nope", "patch")).toThrow(/not a semver/);
  });
});

describe("compareSemver", () => {
  const v = (s: string) => {
    const parsed = parseSemver(s);
    if (!parsed) throw new Error(`bad fixture: ${s}`);
    return parsed;
  };

  it("orders release before its own prerelease", () => {
    expect(compareSemver(v("1.0.0-rc.1"), v("1.0.0"))).toBeLessThan(0);
    expect(compareSemver(v("1.0.0"), v("1.0.0-rc.1"))).toBeGreaterThan(0);
  });

  it("treats equal versions as equal", () => {
    expect(compareSemver(v("0.1.6"), v("0.1.6"))).toBe(0);
  });
});

describe("suggestKind", () => {
  it("recommends a minor bump for new features", () => {
    expect(suggestKind("0.1.6", "### Added\n\n- a thing").kind).toBe("minor");
  });

  it("recommends a patch bump for fixes only", () => {
    expect(suggestKind("0.1.6", "### Fixed\n\n- a bug").kind).toBe("patch");
  });

  it("recommends a patch bump when nothing is named", () => {
    expect(suggestKind("0.1.6", "some text").kind).toBe("patch");
  });

  it("treats removals as minor while the package is 0.x", () => {
    expect(
      suggestKind("0.1.6", "### Removed\n\n- the standalone file").kind,
    ).toBe("minor");
  });

  it("treats removals as major from 1.0.0 on", () => {
    expect(suggestKind("1.2.3", "### Removed\n\n- an API").kind).toBe("major");
  });

  it("treats the word breaking as such", () => {
    expect(
      suggestKind("0.1.6", "### Fixed\n\n- breaking the old path").kind,
    ).toBe("minor");
  });

  it("lets an added feature outrank a removal at 0.x", () => {
    // Both point at minor here, so the order between them cannot be observed
    // at 0.x; this pins the behaviour rather than the precedence.
    expect(
      suggestKind("0.1.6", "### Removed\n\n- x\n\n### Added\n\n- y").kind,
    ).toBe("minor");
  });
});

describe("resolveChoice", () => {
  const candidates = buildCandidates("0.1.6");

  it("lists patch, minor and major in a stable order", () => {
    expect(candidates.map((c) => c.version)).toEqual([
      "0.1.7",
      "0.2.0",
      "1.0.0",
    ]);
  });

  it("maps a number to that candidate", () => {
    expect(resolveChoice("1", candidates, 1)).toEqual({ version: "0.1.7" });
    expect(resolveChoice("2", candidates, 1)).toEqual({ version: "0.2.0" });
    expect(resolveChoice("3", candidates, 1)).toEqual({ version: "1.0.0" });
  });

  it("takes the recommendation on an empty answer", () => {
    expect(resolveChoice("", candidates, 1)).toEqual({ version: "0.2.0" });
    expect(resolveChoice("   ", candidates, 0)).toEqual({ version: "0.1.7" });
  });

  it("accepts a hand typed version", () => {
    expect(resolveChoice("0.3.1", candidates, 0)).toEqual({ version: "0.3.1" });
  });

  it("asks again on nonsense", () => {
    expect(resolveChoice("wat", candidates, 0)).toEqual({ retry: true });
    expect(resolveChoice("0", candidates, 0)).toEqual({ retry: true });
    expect(resolveChoice("4", candidates, 0)).toEqual({ retry: true });
    expect(resolveChoice("1.2", candidates, 0)).toEqual({ retry: true });
  });

  it("aborts instead of choosing when stdin closed", () => {
    for (const closed of [undefined, null]) {
      const choice = resolveChoice(closed, candidates, 0);
      expect("version" in choice).toBe(false);
      expect("abort" in choice && choice.abort).toMatch(/Ctrl\+D/);
    }
  });
});
