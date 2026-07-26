import { invoke } from "@tauri-apps/api/core";
import type { CaptureMetadata, CommandFailure, ResultExportFormat, ReverseResult } from "../../shared/contracts";
import { downloadBlob, isDesktopApp } from "./core";

export async function exportResult(result: ReverseResult, format: ResultExportFormat = "markdown", captureMetadata?: CaptureMetadata): Promise<boolean> {
  const content = format === "json" ? JSON.stringify(toStructuredResult(result, captureMetadata), null, 2)
    : format === "text" ? toPromptText(result) : toMarkdown(result, captureMetadata);
  if (isDesktopApp()) return invoke<boolean>("export_result", { result, format, captureMetadata });
  const extension = format === "json" ? "json" : format === "text" ? "txt" : "md";
  const mime = format === "json" ? "application/json" : "text/plain";
  downloadBlob(new Blob([content], { type: `${mime};charset=utf-8` }), `绘钥反推结果.${extension}`);
  return true;
}

export function toMarkdown(result: ReverseResult, captureMetadata?: CaptureMetadata): string {
  const { analysis } = result;
  const active = getActivePromptVersion(result);
  const prompts = active?.prompts ?? result.prompts;
  const negativePrompts = active?.negativePrompts;
  const metadata = active?.metadata ?? result.metadata;
  const negativeSection = active?.target === "sdxl" && negativePrompts
    ? `\n## 中文负面提示词\n\n${negativePrompts.zh}\n\n## 英文负面提示词\n\n${negativePrompts.en}\n` : "";
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
  if (error && typeof error === "object" && "message" in error) return String((error as CommandFailure).message);
  return "操作失败，请稍后重试";
}

export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) return String((error as CommandFailure).code);
  return undefined;
}

export function getCommandFailure(error: unknown): CommandFailure {
  if (error && typeof error === "object" && "code" in error && "message" in error) return error as CommandFailure;
  return { code: "unknown", message: getErrorMessage(error) };
}
