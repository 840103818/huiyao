import { describe, expect, it } from "vitest";
import { formatGeneratedAt, getErrorMessage, toMarkdown, toPromptText, toStructuredResult } from "./bridge";
import type { ReverseResult } from "../types";

const result: ReverseResult = {
  analysis: {
    subject: "主体", scene: "场景背景", composition: "构图", lighting: "光线", tonality: "影调曝光", colors: "色彩",
    palette: [], materials: "材质", style: "风格", camera: "镜头成像", postProcessing: "后期处理",
  },
  prompts: { zh: "中文提示词", en: "English prompt" },
  metadata: { model: "test-model", elapsedMs: 1250, totalTokens: 42, createdAt: "2026-01-01T00:00:00Z" },
};

describe("bridge helpers", () => {
  it("exports both prompt languages to markdown", () => {
    const markdown = toMarkdown(result);
    expect(markdown).toContain("## 中文提示词");
    expect(markdown).toContain("## 英文提示词");
    expect(markdown).toContain("**场景背景**：场景背景");
    expect(markdown).toContain("**影调曝光**：影调曝光");
    expect(markdown).toContain("**后期处理**：后期处理");
    expect(markdown).toContain(result.prompts.en);
    expect(markdown).toMatch(/生成时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(markdown).not.toContain("参数建议");
  });

  it("normalizes structured command errors", () => {
    expect(getErrorMessage({ code: "timeout", message: "请求超时" })).toBe("请求超时");
    expect(getErrorMessage("网络错误")).toBe("网络错误");
  });

  it("exports only the active optimized prompt version including SDXL negatives", () => {
    const optimized: ReverseResult = {
      ...result,
      promptVersions: [{
        id: "sdxl-1", target: "sdxl", requirements: "", prompts: { zh: "优化中文", en: "optimized English" },
        negativePrompts: { zh: "模糊", en: "blur" }, metadata: { ...result.metadata, model: "optimizer" },
      }],
      activePromptVersionId: "sdxl-1",
    };
    const markdown = toMarkdown(optimized);
    expect(markdown).toContain("优化中文");
    expect(markdown).toContain("## 中文负面提示词");
    expect(markdown).toContain("blur");
    expect(markdown).not.toContain("\n中文提示词\n");
  });

  it("formats generated timestamps as local 24-hour time", () => {
    expect(formatGeneratedAt("2026-07-25T16:08:09")).toBe("2026-07-25 16:08:09");
    expect(formatGeneratedAt("invalid")).toBe("--");
    expect(formatGeneratedAt("")).toBe("--");
  });

  it("exports allowlisted capture facts and a versioned JSON schema", () => {
    const captureMetadata = { cameraModel: "Camera X", focalLength: "50 mm", iso: "100" };
    const markdown = toMarkdown(result, captureMetadata);
    const structured = toStructuredResult(result, captureMetadata);
    expect(markdown).toContain("## 文件实拍信息");
    expect(markdown).toContain("Camera X");
    expect(structured).toMatchObject({ schemaVersion: 1, kind: "huiyao.reverse-prompt", captureMetadata });
    expect(JSON.stringify(structured)).not.toContain("gps");
  });

  it("exports only active prompts as plain text", () => {
    const text = toPromptText(result);
    expect(text).toContain("中文提示词\n中文提示词");
    expect(text).toContain("英文提示词\nEnglish prompt");
    expect(text).not.toContain("摄影测定");
  });
});
