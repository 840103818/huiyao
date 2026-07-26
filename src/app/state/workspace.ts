import type { GenerationState, ImageInfo, PreparedImage, ReverseResult } from "../../shared/contracts";

export function generationStateLabel(state: GenerationState): string {
  if (state === "connecting") return "正在连接";
  if (state === "streaming") return "实时生成";
  if (state === "fallback") return "兼容模式";
  if (state === "stopping") return "正在停止";
  if (state === "cancelled") return "已停止";
  if (state === "complete") return "生成完成";
  return "等待生成";
}

export function generationStateClass(state: GenerationState): string {
  if (["connecting", "streaming", "fallback", "stopping"].includes(state)) return "working";
  if (state === "cancelled") return "cancelled";
  return state === "complete" ? "" : "idle";
}

export function countCompletedAnalysis(result: ReverseResult | null): number {
  if (!result) return 0;
  const { analysis } = result;
  return [analysis.subject, analysis.scene, analysis.composition, analysis.lighting, analysis.tonality, analysis.colors, analysis.materials, analysis.style, analysis.camera, analysis.postProcessing]
    .filter(Boolean).length;
}

export function fileTitle(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").slice(0, 32) || "图片反推";
}

export function toImageInfo(image: PreparedImage): ImageInfo {
  return { name: image.name, width: image.width, height: image.height, size: image.size, mimeType: image.mimeType };
}

export function simplifyAspectRatio(width: number, height: number): string {
  const divisor = greatestCommonDivisor(Math.max(1, width), Math.max(1, height));
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.round(a);
  let right = Math.round(b);
  while (right) [left, right] = [right, left % right];
  return left || 1;
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function clipboardTimestamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
