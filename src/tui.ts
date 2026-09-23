import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Plugin } from "@opencode/plugin/tui";

const DEFAULT_BRIDGE = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "model-hide.json",
);

function bridgePath() {
  return process.env.MODEL_HIDE_BRIDGE_FILE ?? DEFAULT_BRIDGE;
}

type BridgeState = {
  hidden: Set<string>;
  favorite?: string;
};

function readState(): BridgeState {
  try {
    const parsed = JSON.parse(fs.readFileSync(bridgePath(), "utf8")) as {
      hidden?: unknown;
      favorite?: unknown;
    };
    return {
      hidden: Array.isArray(parsed.hidden)
        ? new Set(parsed.hidden.map(String))
        : new Set(),
      favorite:
        typeof parsed.favorite === "string" && parsed.favorite
          ? parsed.favorite
          : undefined,
    };
  } catch {
    return { hidden: new Set() };
  }
}

function writeState(state: BridgeState): void {
  fs.mkdirSync(path.dirname(bridgePath()), { recursive: true });
  const payload: { hidden: string[]; favorite?: string } = {
    hidden: [...state.hidden].sort(),
  };
  if (state.favorite) payload.favorite = state.favorite;
  fs.writeFileSync(bridgePath(), `${JSON.stringify(payload, null, 2)}\n`);
  prioritizeFavoriteInRecent();
}

type NativeModelEntry = {
  providerID: string;
  modelID: string;
};

function nativeModelStatePath(): string {
  const stateHome =
    process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(stateHome, "opencode", "model.json");
}

function parseModelRef(ref: string | undefined): NativeModelEntry | undefined {
  if (!ref) return undefined;
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  const providerID = ref.slice(0, slash);
  const modelID = ref.slice(slash + 1);
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

function prioritizeFavoriteInRecent(): void {
  const favorite = parseModelRef(readState().favorite);
  if (!favorite) return;

  const file = nativeModelStatePath();
  let state: Record<string, unknown>;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    state = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") return;
    state = {};
  }

  const recent = Array.isArray(state.recent)
    ? state.recent.flatMap((value): NativeModelEntry[] => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          return [];
        const record = value as Record<string, unknown>;
        if (
          typeof record.providerID !== "string" ||
          typeof record.modelID !== "string"
        )
          return [];
        return [{ providerID: record.providerID, modelID: record.modelID }];
      })
    : [];
  if (
    recent[0]?.providerID === favorite.providerID &&
    recent[0]?.modelID === favorite.modelID
  )
    return;

  const seen = new Set<string>();
  const nextRecent = [favorite, ...recent]
    .filter((model) => {
      const key = `${model.providerID}/${model.modelID}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
  const nextState = { ...state, recent: nextRecent };
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify(nextState, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Ignore cleanup failures for a best-effort native-state synchronization.
    }
  }
}

type ModelEntry = {
  ref: string;
  providerID: string;
  modelID: string;
  name: string;
};

type ModelDialogState = {
  open: boolean;
  current?: string;
  models: readonly ModelEntry[];
  toggleFavorite?: () => void;
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

function readCatalog(): ModelEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath(), "utf8")) as {
      models?: unknown;
    };
    if (!Array.isArray(parsed.models)) return [];
    return parsed.models.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const record = value as Record<string, unknown>;
      if (
        typeof record.ref !== "string" ||
        typeof record.providerID !== "string"
      )
        return [];
      const modelID =
        typeof record.modelID === "string"
          ? record.modelID
          : String(record.modelID ?? "");
      if (!modelID) return [];
      return [
        {
          ref: record.ref,
          providerID: record.providerID,
          modelID,
          name:
            typeof record.name === "string" && record.name
              ? record.name
              : modelID,
        },
      ];
    });
  } catch {
    return [];
  }
}

export default Plugin.define({
  id: "model-hide.tui",
  setup(context) {
    prioritizeFavoriteInRecent();

    const loadModels = async () => {
      const location = context.location ?? context.data.location.default();
      await Promise.all([
        context.data.location.model.sync(location),
        context.data.location.provider.sync(location),
      ]);

      const byRef = new Map(readCatalog().map((model) => [model.ref, model]));
      for (const model of context.data.location.model.list(location) ?? []) {
        const providerID = String(model.providerID);
        const modelID = String(model.id);
        const ref = `${providerID}/${modelID}`;
        byRef.set(ref, {
          ref,
          providerID,
          modelID,
          name: model.name || modelID,
        });
      }

      const providerNames = new Map(
        (context.data.location.provider.list(location) ?? []).map(
          (provider) => [String(provider.id), provider.name],
        ),
      );
      const models = [...byRef.values()].sort((a, b) => {
        const categoryA = providerNames.get(a.providerID) ?? a.providerID;
        const categoryB = providerNames.get(b.providerID) ?? b.providerID;
        return (
          categoryA.localeCompare(categoryB) ||
          a.name.localeCompare(b.name) ||
          a.ref.localeCompare(b.ref)
        );
      });
      return { models, providerNames };
    };

    let modelDialog: ModelDialogState | undefined;
    const moveModelDialog = (delta: number): false => {
      if (!modelDialog?.open || !modelDialog.current) return false;
      const index = modelDialog.models.findIndex(
        (model) => model.ref === modelDialog?.current,
      );
      if (index < 0) return false;
      const next = modelDialog.models[index + delta];
      if (next) modelDialog.current = next.ref;
      return false;
    };

    return context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          priority: 100,
          commands: [
            {
              id: "model-hide.manage",
              title: "Manage hidden models",
              group: "Model hide",
              bind: "ctrl+shift+h",
              palette: true,
              slash: { name: "model-hide" },
              enabled: () => true,
              run: async () => {
                const { models, providerNames } = await loadModels();

                if (models.length === 0) {
                  context.ui.toast.show({
                    message: "No models available yet",
                    variant: "warning",
                  });
                  return;
                }

                const state = readState();
                const hidden = state.hidden;
                let favorite = state.favorite;
                let current =
                  favorite && models.some((model) => model.ref === favorite)
                    ? favorite
                    : models[0]?.ref;
                let changes = 0;
                let favoriteChanged = false;
                modelDialog = {
                  open: false,
                  current,
                  models,
                  toggleFavorite: () => {
                    const selected = modelDialog?.current ?? current;
                    if (!selected) return;
                    if (favorite === selected) favorite = undefined;
                    else {
                      favorite = selected;
                      hidden.delete(selected);
                    }
                    favoriteChanged = true;
                    changes += 1;
                  },
                };
                try {
                  for (;;) {
                    modelDialog.open = true;
                    modelDialog.current = current;
                    const options = models.map((model) => ({
                      title: model.name,
                      description:
                        model.name === model.modelID ? "" : model.modelID,
                      footer: `${favorite === model.ref ? "⭐" : ""}${hidden.has(model.ref) ? "🔴" : "🟢"}`,
                      category:
                        providerNames.get(model.providerID) ?? model.providerID,
                      value: model.ref,
                    }));
                    const picked = await context.ui.dialog.select({
                      title:
                        "Models — 🟢 visible · 🔴 hidden · ⭐ default · Enter toggle · Ctrl+A favorite",
                      options,
                      current,
                    });
                    modelDialog.open = false;
                    if (favoriteChanged) {
                      favoriteChanged = false;
                      current = modelDialog?.current ?? current;
                      continue;
                    }
                    if (!picked) {
                      if (changes > 0) {
                        writeState({ hidden, favorite });
                        context.ui.toast.show({
                          message:
                            changes === 1
                              ? "Model status saved"
                              : `${changes} changes saved`,
                          variant: "success",
                        });
                      }
                      return;
                    }
                    current = picked;
                    modelDialog.current = current;
                    if (hidden.has(picked)) {
                      hidden.delete(picked);
                      if (favorite === picked) favorite = undefined;
                    } else hidden.add(picked);
                    changes += 1;
                  }
                } finally {
                  modelDialog = undefined;
                }
              },
            },
            {
              id: "model-hide.previous",
              title: "Previous model",
              bind: "up",
              enabled: () => Boolean(modelDialog?.open),
              run: () => moveModelDialog(-1),
            },
            {
              id: "model-hide.next",
              title: "Next model",
              bind: "down",
              enabled: () => Boolean(modelDialog?.open),
              run: () => moveModelDialog(1),
            },
            {
              id: "model-hide.favorite",
              title: "Toggle default model",
              bind: "ctrl+a",
              enabled: () => Boolean(modelDialog?.open),
              run: () => {
                modelDialog?.toggleFavorite?.();
                context.ui.dialog.clear();
              },
            },
          ],
          bindings: [
            "model-hide.manage",
            "model-hide.previous",
            "model-hide.next",
            "model-hide.favorite",
          ],
        }));
        return null;
      },
    });
  },
});
