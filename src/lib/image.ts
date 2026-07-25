import type { PreparedImage } from "../types";

const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_EDGE = 32768;
const MAX_SOURCE_PIXELS = 80_000_000;
const MODEL_MAX_EDGE = 2048;
const THUMB_MAX_EDGE = 320;

export async function prepareImage(
  file: File,
  sourceDimensions?: { width: number; height: number },
): Promise<PreparedImage> {
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error("仅支持 PNG、JPEG 和 WebP 图片");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("图片不能超过 20 MB");
  }

  const dimensions = sourceDimensions ?? await readSourceDimensions(file);
  if (dimensions.width > MAX_SOURCE_EDGE || dimensions.height > MAX_SOURCE_EDGE || dimensions.width * dimensions.height > MAX_SOURCE_PIXELS) {
    throw new Error("图片像素尺寸过大，请缩小后重试");
  }
  const scale = Math.min(1, MODEL_MAX_EDGE / Math.max(dimensions.width, dimensions.height));
  const decodeWidth = Math.max(1, Math.round(dimensions.width * scale));
  const decodeHeight = Math.max(1, Math.round(dimensions.height * scale));
  const bitmap = await createImageBitmap(file, {
    resizeWidth: decodeWidth,
    resizeHeight: decodeHeight,
    resizeQuality: "high",
  });
  try {
    const modelBlob = await renderBitmap(bitmap, MODEL_MAX_EDGE, file.type, 0.9);
    const thumbnailBlob = await renderBitmap(bitmap, THUMB_MAX_EDGE, "image/jpeg", 0.78);
    return {
      name: file.name,
      previewUrl: URL.createObjectURL(modelBlob),
      modelDataUrl: await blobToDataUrl(modelBlob),
      thumbnail: await blobToDataUrl(thumbnailBlob),
      width: dimensions.width,
      height: dimensions.height,
      size: file.size,
      mimeType: file.type,
      originalFile: file,
    };
  } finally {
    bitmap.close();
  }
}

async function renderBitmap(
  bitmap: ImageBitmap,
  maxEdge: number,
  mimeType: string,
  quality: number,
): Promise<Blob> {
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
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("当前系统无法编码图片")), outputType, quality);
  });
}

async function readSourceDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片编码失败"));
    reader.onerror = () => reject(reader.error ?? new Error("图片编码失败"));
    reader.readAsDataURL(blob);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
