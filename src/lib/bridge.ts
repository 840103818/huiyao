import { setTheme as setAppTheme } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  CommandFailure,
  CaptureMetadata,
  HistoryItem,
  OriginalImageCommit,
  OriginalImageStage,
  OriginalStorageStats,
  PromptOptimizationOutput,
  PromptOptimizationRequest,
  PublicSettings,
  ReverseRequest,
  ReverseResult,
  ReverseStreamEvent,
  ResultExportFormat,
  RuntimeLogEntry,
  SettingsInput,
  ThemeMode,
  WorkspacePreferences,
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
  autoSaveHistory: true,
  workspace: {
    outputLanguage: "chinese",
    detailLevel: "expert",
    fitMode: "contain",
  },
};

export function isDesktopApp(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function getSettings(): Promise<PublicSettings> {
  if (isDesktopApp()) return invoke<PublicSettings>("get_settings");
  const stored = migrateLocalValue(SETTINGS_KEY, LEGACY_SETTINGS_KEY);
  return stored ? normalizeSettings(JSON.parse(stored)) : defaultSettings;
}

export async function saveSettings(input: SettingsInput): Promise<PublicSettings> {
  if (isDesktopApp()) return invoke<PublicSettings>("save_settings", { input });
  const settings: PublicSettings = {
    baseUrl: input.baseUrl,
    model: input.model,
    timeoutSeconds: input.timeoutSeconds,
    theme: input.theme,
    hasApiKey: Boolean(input.apiKey) || (!input.clearApiKey && getLocalSettings().hasApiKey),
    autoSaveHistory: input.autoSaveHistory,
    insecureHttpOrigin: input.insecureHttpOrigin,
    workspace: getLocalSettings().workspace,
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
  if (!isDesktopApp()) return;
  await setAppTheme(theme === "system" ? null : theme);
}

export async function setViewerChromeHidden(hidden: boolean): Promise<void> {
  if (!isDesktopApp()) return;
  await getCurrentWindow().setDecorations(!hidden);
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

export async function runPromptOptimization(
  request: PromptOptimizationRequest,
  onEvent: (event: ReverseStreamEvent) => void,
): Promise<PromptOptimizationOutput> {
  if (isDesktopApp()) {
    const channel = new Channel<ReverseStreamEvent>();
    channel.onmessage = onEvent;
    return invoke<PromptOptimizationOutput>("optimize_prompt_stream", { request, onEvent: channel });
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

export async function persistHistory(items: HistoryItem[], originalCommit?: OriginalImageCommit): Promise<void> {
  const limited = items.slice(0, 50);
  if (isDesktopApp()) {
    await invoke("save_history", { items: limited, originalCommit });
  } else {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(limited));
  }
}

export async function stageOriginalImage(file: File): Promise<OriginalImageStage> {
  if (!isDesktopApp()) throw desktopOnlyError("原图保留仅在 macOS 桌面应用中可用");
  const metadata = new TextEncoder().encode(JSON.stringify({ fileName: file.name, mimeType: file.type }));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const body = new Uint8Array(8 + metadata.length + bytes.length);
  body.set([0x48, 0x59, 0x55, 0x50], 0);
  new DataView(body.buffer).setUint32(4, metadata.length, false);
  body.set(metadata, 8);
  body.set(bytes, 8 + metadata.length);
  return invoke<OriginalImageStage>("stage_original_image", body);
}

export async function discardOriginalStage(stagingId: string): Promise<void> {
  if (isDesktopApp()) await invoke("discard_original_stage", { stagingId });
}

export async function loadOriginalImage(historyId: string): Promise<Uint8Array> {
  if (!isDesktopApp()) throw desktopOnlyError("原图读取仅在 macOS 桌面应用中可用");
  const response = await invoke<ArrayBuffer | Uint8Array>("load_original_image", { historyId });
  return response instanceof Uint8Array ? response : new Uint8Array(response);
}

export async function exportOriginalImage(historyId: string): Promise<boolean> {
  if (!isDesktopApp()) throw desktopOnlyError("原图导出仅在 macOS 桌面应用中可用");
  return invoke<boolean>("export_original_image", { historyId });
}

export async function getOriginalStorageStats(): Promise<OriginalStorageStats> {
  if (!isDesktopApp()) return { count: 0, totalBytes: 0 };
  return invoke<OriginalStorageStats>("get_original_storage_stats");
}

export async function removeHistoryOriginal(historyId: string): Promise<void> {
  if (isDesktopApp()) await invoke("remove_history_original", { historyId });
}

export async function clearOriginalImages(): Promise<number> {
  if (!isDesktopApp()) return 0;
  return invoke<number>("clear_original_images");
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

export async function exportRuntimeLogs(entries: RuntimeLogEntry[]): Promise<boolean> {
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : "");
  const filename = `绘钥运行日志-${new Date().toISOString().slice(0, 10)}.jsonl`;
  if (isDesktopApp()) {
    return invoke<boolean>("export_runtime_logs");
  }
  downloadText(content, filename, "application/x-ndjson;charset=utf-8");
  return true;
}

export async function exportResult(result: ReverseResult, format: ResultExportFormat = "markdown", captureMetadata?: CaptureMetadata): Promise<boolean> {
  const content = format === "json"
    ? JSON.stringify(toStructuredResult(result, captureMetadata), null, 2)
    : format === "text" ? toPromptText(result) : toMarkdown(result, captureMetadata);
  if (isDesktopApp()) {
    return invoke<boolean>("export_result", { result, format, captureMetadata });
  }
  const extension = format === "json" ? "json" : format === "text" ? "txt" : "md";
  const mime = format === "json" ? "application/json" : "text/plain";
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  downloadBlob(blob, `绘钥反推结果.${extension}`);
  return true;
}

export async function exportDiagnostic(diagnosticId: string): Promise<boolean> {
  if (isDesktopApp()) return invoke<boolean>("export_diagnostic", { diagnosticId });
  throw desktopOnlyError();
}

export function toMarkdown(result: ReverseResult, captureMetadata?: CaptureMetadata): string {
  const { analysis } = result;
  const active = getActivePromptVersion(result);
  const prompts = active?.prompts ?? result.prompts;
  const negativePrompts = active?.negativePrompts;
  const metadata = active?.metadata ?? result.metadata;
  const negativeSection = active?.target === "sdxl" && negativePrompts
    ? `\n## 中文负面提示词\n\n${negativePrompts.zh}\n\n## 英文负面提示词\n\n${negativePrompts.en}\n`
    : "";
  const captureSection = captureMetadata ? `
## 文件实拍信息

${captureMetadataMarkdown(captureMetadata)}
` : "";
  return `# 绘钥图片反推结果
${captureSection}

## 摄影测定

- **主体**：${analysis.subject}
- **场景背景**：${analysis.scene ?? ""}
- **构图**：${analysis.composition}
- **光线**：${analysis.lighting}
- **影调曝光**：${analysis.tonality ?? ""}
- **色彩**：${analysis.colors}
- **材质**：${analysis.materials}
- **风格**：${analysis.style}
- **镜头成像**：${analysis.camera}
- **后期处理**：${analysis.postProcessing ?? ""}

## 中文提示词

${prompts.zh}

## 英文提示词

${prompts.en}
${negativeSection}

---

- 模型：${metadata.model}
- 令牌数：${metadata.totalTokens ?? "--"}
- 耗时：${(metadata.elapsedMs / 1000).toFixed(2)} 秒
- 生成时间：${formatGeneratedAt(metadata.createdAt)}
`;
}

export function toPromptText(result: ReverseResult): string {
  const active = getActivePromptVersion(result);
  const prompts = active?.prompts ?? result.prompts;
  const negative = active?.negativePrompts;
  const sections = [
    prompts.zh ? `中文提示词\n${prompts.zh}` : "",
    prompts.en ? `英文提示词\n${prompts.en}` : "",
    negative?.zh ? `中文负面提示词\n${negative.zh}` : "",
    negative?.en ? `英文负面提示词\n${negative.en}` : "",
  ].filter(Boolean);
  return `${sections.join("\n\n")}\n`;
}

export function toStructuredResult(result: ReverseResult, captureMetadata?: CaptureMetadata) {
  const active = getActivePromptVersion(result);
  return {
    schemaVersion: 1,
    kind: "huiyao.reverse-prompt",
    captureMetadata: captureMetadata ?? null,
    analysis: result.analysis,
    activePrompt: {
      id: active?.id ?? "base",
      origin: active?.origin ?? "base",
      target: active?.target ?? "general",
      title: active?.title ?? (active ? targetLabelsForExport[active.target] : "原始反推版本"),
      prompts: active?.prompts ?? result.prompts,
      negativePrompts: active?.negativePrompts ?? { zh: "", en: "" },
      metadata: active?.metadata ?? result.metadata,
    },
    baseMetadata: result.metadata,
  };
}

const targetLabelsForExport = { general: "通用", midjourney: "Midjourney", flux: "Flux", sdxl: "SDXL" } as const;

function captureMetadataMarkdown(metadata: CaptureMetadata): string {
  const rows: Array<[keyof CaptureMetadata, string]> = [
    ["cameraMake", "相机品牌"], ["cameraModel", "相机型号"], ["lensMake", "镜头品牌"], ["lensModel", "镜头型号"],
    ["focalLength", "焦距"], ["focalLength35mm", "等效焦距"], ["aperture", "光圈"], ["exposureTime", "快门"],
    ["iso", "ISO"], ["exposureBias", "曝光补偿"], ["flash", "闪光灯"], ["whiteBalance", "白平衡"],
    ["capturedAt", "拍摄时间"], ["colorSpace", "色彩空间"],
  ];
  return rows.flatMap(([key, label]) => metadata[key] ? [`- **${label}**：${metadata[key]}`] : []).join("\n") || "- 未提供可用 EXIF";
}

export function formatGeneratedAt(value: string): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function getActivePromptVersion(result: ReverseResult) {
  return result.promptVersions?.find((version) => version.id === result.activePromptVersionId);
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

export function getCommandFailure(error: unknown): CommandFailure {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return error as CommandFailure;
  }
  return { code: "unknown", message: getErrorMessage(error) };
}

function getLocalSettings(): PublicSettings {
  const stored = migrateLocalValue(SETTINGS_KEY, LEGACY_SETTINGS_KEY);
  return stored ? normalizeSettings(JSON.parse(stored)) : defaultSettings;
}

function normalizeSettings(value: Partial<PublicSettings>): PublicSettings {
  return {
    ...defaultSettings,
    ...value,
    workspace: { ...defaultSettings.workspace, ...(value.workspace ?? {}) },
  };
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
    const result = historyItem.result && typeof historyItem.result === "object"
      ? historyItem.result as Record<string, unknown>
      : {};
    const analysis = result.analysis && typeof result.analysis === "object"
      ? result.analysis as Record<string, unknown>
      : {};
    const promptVersions = Array.isArray(result.promptVersions) ? result.promptVersions.slice(0, 8) : [];
    const activePromptVersionId = typeof result.activePromptVersionId === "string"
      && promptVersions.some((version) => version && typeof version === "object" && (version as { id?: string }).id === result.activePromptVersionId)
      ? result.activePromptVersionId
      : undefined;
    historyItem.result = {
      ...result,
      analysis: { scene: "", tonality: "", postProcessing: "", ...analysis },
      promptVersions,
      activePromptVersionId,
    };
    return [historyItem as unknown as HistoryItem];
  }).slice(0, 50);
}

function desktopOnlyError(message = "模型请求仅在 macOS 桌面应用中可用"): CommandFailure {
  return {
    code: "desktop_only",
    message,
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
