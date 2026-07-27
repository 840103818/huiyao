import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PublicSettings } from "../../shared/contracts";
import { SettingsView } from "./SettingsView";

vi.mock("../../infrastructure/tauri", () => ({
  clearOriginalImages: vi.fn().mockResolvedValue(0),
  getErrorMessage: (error: unknown) => String(error),
  getOriginalStorageStats: vi.fn().mockResolvedValue({ count: 0, totalBytes: 0 }),
  saveSettings: vi.fn(),
  testConnection: vi.fn(),
}));

const settings: PublicSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  timeoutSeconds: 120,
  theme: "light",
  hasApiKey: true,
  autoSaveHistory: true,
  workspace: { outputLanguage: "chinese", detailLevel: "expert", fitMode: "contain" },
  batchConcurrency: 1,
  storageQuotaBytes: 10 * 1024 ** 3,
  progressiveDisclosure: true,
};

describe("SettingsView", () => {
  it("marks the selected category while navigating the continuous settings surface", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    render(<SettingsView settings={settings} onSaved={vi.fn()} onThemeChange={vi.fn()} onDirtyChange={vi.fn()} />);

    const storage = screen.getByRole("button", { name: "原图存储" });
    fireEvent.click(storage);

    expect(storage).toHaveClass("is-active");
    expect(storage).toHaveAttribute("aria-current", "page");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });
});
