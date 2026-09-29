import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Plugin } from "@opencode/plugin";
import plugin from "../src/index.js";

type FakeModel = {
  providerID: string;
  id: string;
  name: string;
  enabled?: boolean;
};

const ALL_MODELS: FakeModel[] = [
  { providerID: "opencode-go", id: "space-bunny-free", name: "Space Bunny" },
  { providerID: "opencode-go", id: "kimi-k2.6", name: "Kimi K2.6" },
  { providerID: "anthropic", id: "opus-5", name: "Opus 5", enabled: false },
];

let dir: string;
let bridgeFile: string;
let catalogFile: string;
const disposers: Array<() => void> = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "model-hide-test-"));
  bridgeFile = path.join(dir, "model-hide.json");
  catalogFile = path.join(dir, "model-hide.catalog.json");
  process.env.MODEL_HIDE_BRIDGE_FILE = bridgeFile;
  process.env.MODEL_HIDE_CATALOG_FILE = catalogFile;
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  delete process.env.MODEL_HIDE_BRIDGE_FILE;
  delete process.env.MODEL_HIDE_CATALOG_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

function writeBridge(content: unknown): void {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  fs.writeFileSync(bridgeFile, text);
}

function readCatalog(): { models: Array<Record<string, string>> } {
  return JSON.parse(fs.readFileSync(catalogFile, "utf8"));
}

/**
 * Boots the real plugin entrypoint against a minimal `ctx`. Nothing about the
 * bridge/catalog logic is mocked: that is the point of the test.
 */
async function setup(models: FakeModel[] = ALL_MODELS) {
  const removed: string[] = [];
  let currentDefault: { providerID: string; modelID: string } | undefined;
  let reloads = 0;

  const editor = {
    list: () => models,
    remove: (providerID: string, modelID: string) =>
      removed.push(`${providerID}/${modelID}`),
    default: {
      get: () => currentDefault,
      set: (providerID: string, modelID: string) => {
        currentDefault = { providerID, modelID };
      },
    },
  };

  const ctx = {
    model: {
      transform: async (fn: (e: unknown) => void) => {
        fn(editor);
        return { dispose: async () => {} };
      },
      reload: async () => {
        reloads += 1;
      },
    },
  } as unknown as Plugin.Context;

  const dispose = await plugin.setup(ctx);
  if (dispose) disposers.push(dispose as () => void);

  return {
    removed,
    getDefault: () => currentDefault,
    getReloads: () => reloads,
  };
}

describe("hidden models", () => {
  it("removes exactly the models listed in the bridge file", async () => {
    writeBridge({ hidden: ["opencode-go/kimi-k2.6", "anthropic/opus-5"] });

    const { removed } = await setup();

    expect(removed).toEqual(["opencode-go/kimi-k2.6", "anthropic/opus-5"]);
  });

  it("leaves every model alone when nothing is hidden", async () => {
    writeBridge({ hidden: [] });

    const { removed } = await setup();

    expect(removed).toEqual([]);
  });

  it("survives a malformed bridge file", async () => {
    writeBridge("{ this is not json");

    const { removed } = await setup();

    expect(removed).toEqual([]);
  });

  it("survives a missing bridge file", async () => {
    const { removed } = await setup();

    expect(removed).toEqual([]);
  });

  it("coerces non-string entries in `hidden`", async () => {
    writeBridge({ hidden: [123, "opencode-go/kimi-k2.6"] });

    const { removed } = await setup();

    expect(removed).toEqual(["opencode-go/kimi-k2.6"]);
  });
});

describe("catalog written for the TUI", () => {
  it("lists every enabled model, sorted by ref", async () => {
    await setup();

    expect(readCatalog().models.map((m) => m.ref)).toEqual([
      "opencode-go/kimi-k2.6",
      "opencode-go/space-bunny-free",
    ]);
  });

  it("omits disabled models", async () => {
    await setup();

    const refs = readCatalog().models.map((m) => m.ref);
    expect(refs).not.toContain("anthropic/opus-5");
  });

  it("falls back to the model id when the name is missing", async () => {
    await setup([{ providerID: "opencode-go", id: "unnamed" } as FakeModel]);

    expect(readCatalog().models[0].name).toBe("unnamed");
  });

  it("does not write a catalog when there are no models", async () => {
    await setup([]);

    expect(fs.existsSync(catalogFile)).toBe(false);
  });

  it("does not rewrite an unchanged catalog", async () => {
    await setup();
    const first = fs.statSync(catalogFile).mtimeMs;

    await setup();

    expect(fs.statSync(catalogFile).mtimeMs).toBe(first);
  });

  it("derives the catalog path from the bridge path", async () => {
    delete process.env.MODEL_HIDE_CATALOG_FILE;

    await setup();

    expect(fs.existsSync(path.join(dir, "model-hide.catalog.json"))).toBe(true);
  });
});

describe("persisted default", () => {
  it("applies the favorite from the bridge file", async () => {
    writeBridge({ favorite: "opencode-go/space-bunny-free" });

    const { getDefault } = await setup();

    expect(getDefault()).toEqual({
      providerID: "opencode-go",
      modelID: "space-bunny-free",
    });
  });

  it("never defaults to a hidden model", async () => {
    writeBridge({
      hidden: ["opencode-go/space-bunny-free"],
      favorite: "opencode-go/space-bunny-free",
    });

    const { getDefault } = await setup();

    expect(getDefault()).toBeUndefined();
  });

  it("never defaults to a disabled model", async () => {
    writeBridge({ favorite: "anthropic/opus-5" });

    const { getDefault } = await setup();

    expect(getDefault()).toBeUndefined();
  });

  it("ignores a favorite without a provider prefix", async () => {
    writeBridge({ favorite: "space-bunny-free" });

    const { getDefault } = await setup();

    expect(getDefault()).toBeUndefined();
  });

  it("leaves the default untouched when no favorite is set", async () => {
    writeBridge({ hidden: ["opencode-go/kimi-k2.6"] });

    const { getDefault } = await setup();

    expect(getDefault()).toBeUndefined();
  });
});

// Both tests below wait for a real fs.watchFile poll (500ms) plus the 250ms
// debounce in src/index.ts. The per-test timeout has to exceed the waitFor
// budget, otherwise the test dies at vitest's own deadline instead of
// reporting the reload that never arrived.
describe("live reload", () => {
  it(
    "reloads the model catalog when the bridge file changes",
    { timeout: 30_000 },
    async () => {
      writeBridge({ hidden: [] });

      const { getReloads } = await setup();
      expect(getReloads()).toBe(0);

      fs.writeFileSync(
        bridgeFile,
        JSON.stringify({ hidden: ["anthropic/opus-5"] }),
      );

      await vi.waitFor(() => expect(getReloads()).toBeGreaterThan(0), {
        timeout: 20_000,
        interval: 100,
      });
    },
  );

  it(
    "picks up a newly hidden model on the next transform",
    { timeout: 30_000 },
    async () => {
      writeBridge({ hidden: [] });
      const first = await setup();
      expect(first.removed).toEqual([]);

      fs.writeFileSync(
        bridgeFile,
        JSON.stringify({ hidden: ["opencode-go/kimi-k2.6"] }),
      );

      await vi.waitFor(() => expect(first.getReloads()).toBeGreaterThan(0), {
        timeout: 20_000,
        interval: 100,
      });

      const second = await setup();
      expect(second.removed).toEqual(["opencode-go/kimi-k2.6"]);
    },
  );
});
