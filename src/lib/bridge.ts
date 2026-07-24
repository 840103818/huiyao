import { setTheme as setAppTheme } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type {
  CommandFailure,
  HistoryItem,
  PublicSettings,
  ReverseRequest,
  ReverseResult,
  ReverseStreamEvent,
  RuntimeLogEntry,
  SettingsInput,
  ThemeMode,
} from "../types";

const SETTINGS_KEY = "huiyao-settings-v1";
const HISTORY_KEY = "huiyao-history-v1";
const RUNTIME_LOG_KEY = "huiyao-runtime-logs-v1";
const LEGACY_SETTINGS_KEY = "reverse-prompt-settings-v1";
const LEGACY_HISTORY_KEY = "reverse-prompt-history-v2";
const LEGACY_RUNTIME_LOG_KEY = "reverse-prompt-runtime-logs-v1";

const defaultSettings: PublicSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  timeoutSeconds: 120,
  theme: "system",
  hasApiKey: false,
};

export function isDesktopApp(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function getSettings(): Promise<PublicSettings> {
  if (isDesktopApp()) return invoke<PublicSettings>("get_settings");
  const stored = migrateLocalValue(SETTINGS_KEY, LEGACY_SETTINGS_KEY);
  return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
}

export async function saveSettings(input: SettingsInput): Promise<PublicSettings> {
  if (isDesktopApp()) return invoke<PublicSettings>("save_settings", { input });
  const settings: PublicSettings = {
    baseUrl: input.baseUrl,
    model: input.model,
    timeoutSeconds: input.timeoutSeconds,
    theme: input.theme,
    hasApiKey: Boolean(input.apiKey) || (!input.clearApiKey && getLocalSettings().hasApiKey),
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

export async function applyNativeTheme(theme: ThemeMode): Promise<void> {
  if (!isDesktopApp()) return;
  await setAppTheme(theme === "system" ? null : theme);
}

export async function testConnection(input: SettingsInput): Promise<{ model: string; message: string }> {
  if (isDesktopApp()) return invoke("test_connection", { input });
  throw desktopOnlyError();
}

export async function runReversePrompt(
  request: ReverseRequest,
  onEvent: (event: ReverseStreamEvent) => void,
): Promise<ReverseResult> {
  if (isDesktopApp()) {
    const channel = new Channel<ReverseStreamEvent>();
    channel.onmessage = onEvent;
    return invoke<ReverseResult>("reverse_prompt_stream", { request, onEvent: channel });
  }
  throw desktopOnlyError();
}

export async function cancelReversePrompt(interactionId: string): Promise<boolean> {
  if (isDesktopApp()) return invoke<boolean>("cancel_reverse_prompt", { interactionId });
  return false;
}

export async function loadHistory(): Promise<HistoryItem[]> {
  if (isDesktopApp()) return invoke<HistoryItem[]>("load_history");
  const stored = migrateLocalValue(HISTORY_KEY, LEGACY_HISTORY_KEY);
  if (!stored) return [];
  const normalized = normalizeHistory(JSON.parse(stored));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function persistHistory(items: HistoryItem[]): Promise<void> {
  const limited = items.slice(0, 50);
  if (isDesktopApp()) {
    await invoke("save_history", { items: limited });
  } else {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(limited));
  }
}

export async function loadRuntimeLogs(): Promise<RuntimeLogEntry[]> {
  if (isDesktopApp()) return invoke<RuntimeLogEntry[]>("load_runtime_logs");
  const stored = migrateLocalValue(RUNTIME_LOG_KEY, LEGACY_RUNTIME_LOG_KEY);
  return stored ? JSON.parse(stored) : [];
}

export async function clearRuntimeLogs(): Promise<void> {
  if (isDesktopApp()) await invoke("clear_runtime_logs");
  else localStorage.removeItem(RUNTIME_LOG_KEY);
}

export async function exportRuntimeLogs(entries: RuntimeLogEntry[]): Promise<void> {
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : "");
  const filename = `绘钥运行日志-${new Date().toISOString().slice(0, 10)}.jsonl`;
  if (isDesktopApp()) {
    const path = await save({
      defaultPath: filename,
      filters: [{ name: "JSON Lines", extensions: ["jsonl"] }],
    });
    if (path) await invoke("export_markdown", { path, content });
    return;
  }
  downloadText(content, filename, "application/x-ndjson;charset=utf-8");
}

export async function exportResult(result: ReverseResult): Promise<void> {
  const content = toMarkdown(result);
  if (isDesktopApp()) {
    const path = await save({
      defaultPath: `绘钥反推结果-${new Date().toISOString().slice(0, 10)}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (path) await invoke("export_markdown", { path, content });
    return;
  }
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, "绘钥反推结果.md");
}

export function toMarkdown(result: ReverseResult): string {
  const { analysis, prompts, metadata } = result;
  return `# 绘钥图片反推结果

## 要素拆解

- **主体**：${analysis.subject}
- **构图**：${analysis.composition}
- **光线**：${analysis.lighting}
- **色彩**：${analysis.colors}
- **材质**：${analysis.materials}
- **风格**：${analysis.style}
- **镜头**：${analysis.camera}

## 中文提示词

${prompts.zh}

## 英文提示词

${prompts.en}

---

- 模型：${metadata.model}
- 令牌数：${metadata.totalTokens ?? "--"}
- 耗时：${(metadata.elapsedMs / 1000).toFixed(2)} 秒
- 生成时间：${metadata.createdAt}
`;
}

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as CommandFailure).message);
  }
  return "操作失败，请稍后重试";
}

export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as CommandFailure).code);
  }
  return undefined;
}

export function getRawResponse(error: unknown): string | undefined {
  if (error && typeof error === "object" && "rawResponse" in error) {
    const value = (error as CommandFailure).rawResponse;
    return typeof value === "string" && value.trim() ? value : undefined;
  }
  return undefined;
}

function getLocalSettings(): PublicSettings {
  const stored = migrateLocalValue(SETTINGS_KEY, LEGACY_SETTINGS_KEY);
  return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
}

function migrateLocalValue(currentKey: string, legacyKey: string): string | null {
  const current = localStorage.getItem(currentKey);
  if (current !== null) return current;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy !== null) localStorage.setItem(currentKey, legacy);
  return legacy;
}

function normalizeHistory(value: unknown): HistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const legacy = item as Record<string, unknown>;
    if (legacy.mode === "text") return [];
    const { mode: _mode, ...historyItem } = legacy;
    return [historyItem as unknown as HistoryItem];
  }).slice(0, 50);
}

function desktopOnlyError(): CommandFailure {
  return {
    code: "desktop_only",
    message: "模型请求仅在 macOS 桌面应用中可用",
  };
}

function downloadText(content: string, filename: string, type: string): void {
  downloadBlob(new Blob([content], { type }), filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
