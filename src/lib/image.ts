import type { PreparedImage } from "../types";

const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MODEL_MAX_EDGE = 2048;
const THUMB_MAX_EDGE = 320;

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error("仅支持 PNG、JPEG 和 WebP 图片");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("图片不能超过 20 MB");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const modelDataUrl = renderBitmap(bitmap, MODEL_MAX_EDGE, file.type, 0.9);
    const thumbnail = renderBitmap(bitmap, THUMB_MAX_EDGE, "image/jpeg", 0.78);
    return {
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      modelDataUrl,
      thumbnail,
      width: bitmap.width,
      height: bitmap.height,
      size: file.size,
      mimeType: file.type,
    };
  } finally {
    bitmap.close();
  }
}

function renderBitmap(
  bitmap: ImageBitmap,
  maxEdge: number,
  mimeType: string,
  quality: number,
): string {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("当前系统无法处理图片");
  context.drawImage(bitmap, 0, 0, width, height);
  const outputType = mimeType === "image/png" ? "image/png" : "image/jpeg";
  return canvas.toDataURL(outputType, quality);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
