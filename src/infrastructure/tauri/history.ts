import { invoke } from "@tauri-apps/api/core";
import type { HistoryItem, OriginalImageCommit } from "../../shared/contracts";
import { isDesktopApp, migrateLocalValue } from "./core";

const HISTORY_KEY = "huiyao-history-v1";
const LEGACY_HISTORY_KEY = "reverse-prompt-history-v2";

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
  if (isDesktopApp()) await invoke("save_history", { items: limited, originalCommit });
  else localStorage.setItem(HISTORY_KEY, JSON.stringify(limited));
}

function normalizeHistory(value: unknown): HistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const legacy = item as Record<string, unknown>;
    if (legacy.mode === "text") return [];
    const { mode: _mode, ...historyItem } = legacy;
    const result = historyItem.result && typeof historyItem.result === "object" ? historyItem.result as Record<string, unknown> : {};
    const analysis = result.analysis && typeof result.analysis === "object" ? result.analysis as Record<string, unknown> : {};
    const promptVersions = Array.isArray(result.promptVersions) ? result.promptVersions.slice(0, 8) : [];
    const activePromptVersionId = typeof result.activePromptVersionId === "string"
      && promptVersions.some((version) => version && typeof version === "object" && (version as { id?: string }).id === result.activePromptVersionId)
      ? result.activePromptVersionId : undefined;
    historyItem.result = {
      ...result,
      analysis: { scene: "", tonality: "", postProcessing: "", ...analysis },
      promptVersions,
      activePromptVersionId,
    };
    return [historyItem as unknown as HistoryItem];
  }).slice(0, 50);
}
