import { beforeEach, describe, expect, it } from "vitest";
import { getSettings, saveWorkspacePreferences } from "./settings";

const SETTINGS_KEY = "huiyao-settings-v1";

describe("browser workspace settings", () => {
  beforeEach(() => localStorage.clear());

  it("normalizes persisted workspace layout values", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      workspace: {
        outputLanguage: "chinese",
        detailLevel: "expert",
        fitMode: "contain",
        projectSidebarWidth: 900,
        inputSplitPercent: 2,
      },
    }));

    const settings = await getSettings();
    expect(settings.workspace.projectSidebarWidth).toBe(336);
    expect(settings.workspace.inputSplitPercent).toBe(42);
  });

  it("drops malformed optional layout values instead of forcing an edge", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      workspace: {
        outputLanguage: "chinese",
        detailLevel: "expert",
        fitMode: "contain",
        projectSidebarWidth: null,
        inputSplitPercent: "wide",
      },
    }));

    const settings = await getSettings();
    expect(settings.workspace.projectSidebarWidth).toBeUndefined();
    expect(settings.workspace.inputSplitPercent).toBeUndefined();
  });

  it("preserves layout preferences through the existing preference command", async () => {
    await saveWorkspacePreferences({
      outputLanguage: "chinese",
      detailLevel: "expert",
      fitMode: "contain",
      projectSidebarWidth: 288,
      inputSplitPercent: 56,
    });

    const settings = await getSettings();
    expect(settings.workspace.projectSidebarWidth).toBe(288);
    expect(settings.workspace.inputSplitPercent).toBe(56);
  });
});
