import type { CommandFailure } from "../../shared/contracts";

export function isDesktopApp(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function desktopOnlyError(message = "模型请求仅在 macOS 桌面应用中可用"): CommandFailure {
  return { code: "desktop_only", message };
}

export function migrateLocalValue(currentKey: string, legacyKey: string): string | null {
  const current = localStorage.getItem(currentKey);
  if (current !== null) return current;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy !== null) localStorage.setItem(currentKey, legacy);
  return legacy;
}

export function downloadText(content: string, filename: string, type: string): void {
  downloadBlob(new Blob([content], { type }), filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
