/** Type declarations for the pure release helpers (plain ESM JavaScript). */

export type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

export type Candidate = {
  kind: "patch" | "minor" | "major";
  version: string;
  label: string;
};

export type Suggestion = { kind: "patch" | "minor" | "major"; why: string };

export type Choice = { version: string } | { retry: true } | { abort: string };

export declare function parseSemver(version: string): Semver | null;
export declare function compareSemver(a: Semver, b: Semver): number;
export declare function buildCandidates(current: string): Candidate[];
export declare function bumpVersion(version: string, kind: string): string;
export declare function suggestKind(
  current: string,
  pending: string,
): Suggestion;
export declare function resolveChoice(
  answer: unknown,
  candidates: Candidate[],
  recommendedIndex: number,
): Choice;
