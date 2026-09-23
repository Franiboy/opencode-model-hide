import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Plugin } from "@opencode/plugin";

const DEFAULT_BRIDGE = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "model-hide.json",
);

function bridgePath() {
  return process.env.MODEL_HIDE_BRIDGE_FILE ?? DEFAULT_BRIDGE;
}

function readHidden(): Set<string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(bridgePath(), "utf8")) as {
      hidden?: unknown;
    };
    if (Array.isArray(parsed.hidden)) return new Set(parsed.hidden.map(String));
  } catch {
    // Missing or malformed file: treat as "nothing hidden".
  }
  return new Set();
}

function readFavorite(): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(bridgePath(), "utf8")) as {
      favorite?: unknown;
    };
    return typeof parsed.favorite === "string" && parsed.favorite
      ? parsed.favorite
      : undefined;
  } catch {
    return undefined;
  }
}

type ModelEntry = {
  ref: string;
  providerID: string;
  modelID: string;
  name: string;
};

function catalogPath(): string {
  if (process.env.MODEL_HIDE_CATALOG_FILE)
    return process.env.MODEL_HIDE_CATALOG_FILE;
  const bridge = bridgePath();
  const extension = path.extname(bridge);
  const basename = path.basename(bridge, extension);
  return path.join(
    path.dirname(bridge),
    `${basename}.catalog${extension || ".json"}`,
  );
}

function writeCatalog(models: readonly ModelEntry[]): void {
  if (models.length === 0) return;
  const file = catalogPath();
  const content = `${JSON.stringify({ models: [...models].sort((a, b) => a.ref.localeCompare(b.ref)) }, null, 2)}\n`;
  try {
    if (fs.readFileSync(file, "utf8") === content) return;
  } catch {
    // First write or unreadable cache: replace it below.
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  } catch {
    // The catalog is a TUI convenience; model filtering must keep working without it.
  }
}

export default Plugin.define({
  id: "model-hide",
  async setup(ctx) {
    let hidden = readHidden();
    let favorite = readFavorite();

    await ctx.model.transform((editor) => {
      const models = editor.list();
      writeCatalog(
        models
          .filter((model) => model.enabled !== false)
          .map((model) => {
            const providerID = String(model.providerID);
            const modelID = String(model.id);
            return {
              ref: `${providerID}/${modelID}`,
              providerID,
              modelID,
              name: String(model.name ?? modelID),
            };
          }),
      );
      for (const model of models) {
        const providerID = String(model.providerID);
        const modelID = String(model.id);
        if (hidden.has(`${providerID}/${modelID}`)) {
          editor.remove(providerID, modelID);
        }
      }

      if (favorite && !hidden.has(favorite)) {
        const slash = favorite.indexOf("/");
        const providerID = slash > 0 ? favorite.slice(0, slash) : "";
        const modelID = slash > 0 ? favorite.slice(slash + 1) : "";
        if (
          providerID &&
          modelID &&
          models.some(
            (model) =>
              model.enabled !== false &&
              String(model.providerID) === providerID &&
              String(model.id) === modelID,
          )
        ) {
          editor.default.set(providerID, modelID);
        }
      }
    });

    let lastSig = "";
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const sig = () => {
      try {
        const s = fs.statSync(bridgePath());
        return `${s.mtimeMs}:${s.ctimeMs}:${s.size}`;
      } catch {
        return "";
      }
    };
    lastSig = sig();

    fs.watchFile(bridgePath(), { interval: 500 }, () => {
      const next = sig();
      if (next === lastSig) return;
      lastSig = next;
      try {
        hidden = readHidden();
        favorite = readFavorite();
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          reloadTimer = undefined;
          void ctx.model.reload().catch(() => {});
        }, 250);
      } catch {
        // Keep the last known list on transient read errors.
      }
    });

    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      fs.unwatchFile(bridgePath());
    };
  },
});
