import { describe, expect, it } from "vitest";
import {
  buildCandidates,
  bumpVersion,
  compareSemver,
  parseSemver,
  resolveChoice,
  suggestKind,
} from "../scripts/version-choice.mjs";

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
