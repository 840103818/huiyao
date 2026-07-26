import { setTheme as setAppTheme } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PublicSettings, SettingsInput, ThemeMode, WorkspacePreferences } from "../../shared/contracts";
import { desktopOnlyError, isDesktopApp, migrateLocalValue } from "./core";

const SETTINGS_KEY = "huiyao-settings-v1";
const LEGACY_SETTINGS_KEY = "reverse-prompt-settings-v1";

const defaultSettings: PublicSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  timeoutSeconds: 120,
  theme: "system",
  hasApiKey: false,
  autoSaveHistory: true,
  workspace: { outputLanguage: "chinese", detailLevel: "expert", fitMode: "contain" },
  batchConcurrency: 1,
  storageQuotaBytes: 10 * 1024 * 1024 * 1024,
  progressiveDisclosure: true,
};

export async function getSettings(): Promise<PublicSettings> {
  if (isDesktopApp()) return invoke<PublicSettings>("get_settings");
  const stored = migrateLocalValue(SETTINGS_KEY, LEGACY_SETTINGS_KEY);
  return stored ? normalizeSettings(JSON.parse(stored)) : defaultSettings;
}

export async function saveSettings(input: SettingsInput): Promise<PublicSettings> {
  if (isDesktopApp()) return invoke<PublicSettings>("save_settings", { input });
  const current = getLocalSettings();
  const settings: PublicSettings = {
    baseUrl: input.baseUrl,
    model: input.model,
    timeoutSeconds: input.timeoutSeconds,
    theme: input.theme,
    hasApiKey: Boolean(input.apiKey) || (!input.clearApiKey && current.hasApiKey),
    autoSaveHistory: input.autoSaveHistory,
    insecureHttpOrigin: input.insecureHttpOrigin,
    workspace: current.workspace,
    lastProjectId: current.lastProjectId,
    lastTaskId: current.lastTaskId,
    batchConcurrency: input.batchConcurrency ?? current.batchConcurrency,
    storageQuotaBytes: input.storageQuotaBytes ?? current.storageQuotaBytes,
    progressiveDisclosure: input.progressiveDisclosure ?? current.progressiveDisclosure,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export async function saveTheme(theme: ThemeMode): Promise<PublicSettings> {
  if (isDesktopApp()) return invoke<PublicSettings>("save_theme", { theme });
  const settings = { ...getLocalSettings(), theme };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export async function saveWorkspacePreferences(preferences: WorkspacePreferences): Promise<PublicSettings> {
  if (isDesktopApp()) return invoke<PublicSettings>("save_workspace_preferences", { preferences });
  const settings = { ...getLocalSettings(), workspace: preferences };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export async function applyNativeTheme(theme: ThemeMode): Promise<void> {
  if (isDesktopApp()) await setAppTheme(theme === "system" ? null : theme);
}

export async function setViewerChromeHidden(hidden: boolean): Promise<void> {
  if (isDesktopApp()) await getCurrentWindow().setDecorations(!hidden);
}

export async function testConnection(input: SettingsInput): Promise<{ model: string; message: string }> {
  if (isDesktopApp()) return invoke("test_connection", { input });
  throw desktopOnlyError();
}

function getLocalSettings(): PublicSettings {
  const stored = migrateLocalValue(SETTINGS_KEY, LEGACY_SETTINGS_KEY);
  return stored ? normalizeSettings(JSON.parse(stored)) : defaultSettings;
}

function normalizeSettings(value: Partial<PublicSettings>): PublicSettings {
  return { ...defaultSettings, ...value, workspace: { ...defaultSettings.workspace, ...(value.workspace ?? {}) } };
}
