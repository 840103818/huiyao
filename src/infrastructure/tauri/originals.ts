import { invoke } from "@tauri-apps/api/core";
import type { OriginalImageStage, OriginalStorageStats } from "../../shared/contracts";
import { desktopOnlyError, isDesktopApp } from "./core";

const SUPPORTED_ORIGINAL_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_ORIGINAL_FILE_BYTES = 20 * 1024 * 1024;

export async function stageOriginalImage(file: File): Promise<OriginalImageStage> {
  if (!isDesktopApp()) throw desktopOnlyError("原图保留仅在 macOS 桌面应用中可用");
  validateOriginalImageUpload(file);
  const metadata = new TextEncoder().encode(JSON.stringify({ fileName: file.name, mimeType: file.type }));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const body = new Uint8Array(8 + metadata.length + bytes.length);
  body.set([0x48, 0x59, 0x55, 0x50], 0);
  new DataView(body.buffer).setUint32(4, metadata.length, false);
  body.set(metadata, 8);
  body.set(bytes, 8 + metadata.length);
  return invoke<OriginalImageStage>("stage_original_image", body);
}

export function validateOriginalImageUpload(file: Pick<File, "size" | "type">): void {
  if (!SUPPORTED_ORIGINAL_TYPES.has(file.type)) {
    throw new Error("仅支持 PNG、JPEG 和 WebP 图片");
  }
  if (file.size <= 0 || file.size > MAX_ORIGINAL_FILE_BYTES) {
    throw new Error("图片不能为空且不能超过 20 MB");
  }
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
  return isDesktopApp() ? invoke<OriginalStorageStats>("get_original_storage_stats") : { count: 0, totalBytes: 0 };
}

export async function removeHistoryOriginal(historyId: string): Promise<void> {
  if (isDesktopApp()) await invoke("remove_history_original", { historyId });
}

export async function clearOriginalImages(): Promise<number> {
  return isDesktopApp() ? invoke<number>("clear_original_images") : 0;
}
