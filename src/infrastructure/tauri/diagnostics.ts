import { invoke } from "@tauri-apps/api/core";
import type { RuntimeLogEntry } from "../../shared/contracts";
import { desktopOnlyError, downloadText, isDesktopApp, migrateLocalValue } from "./core";

const RUNTIME_LOG_KEY = "huiyao-runtime-logs-v1";
const LEGACY_RUNTIME_LOG_KEY = "reverse-prompt-runtime-logs-v1";

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
  if (isDesktopApp()) return invoke<boolean>("export_runtime_logs");
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : "");
  downloadText(content, `绘钥运行日志-${new Date().toISOString().slice(0, 10)}.jsonl`, "application/x-ndjson;charset=utf-8");
  return true;
}

export async function exportDiagnostic(diagnosticId: string): Promise<boolean> {
  if (isDesktopApp()) return invoke<boolean>("export_diagnostic", { diagnosticId });
  throw desktopOnlyError();
}
