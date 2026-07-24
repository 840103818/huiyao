import { describe, expect, it } from "vitest";
import { getErrorMessage, toMarkdown } from "./bridge";
import type { ReverseResult } from "../types";

const result: ReverseResult = {
  analysis: {
    subject: "主体", composition: "构图", lighting: "光线", colors: "色彩",
    palette: [], materials: "材质", style: "风格", camera: "镜头",
  },
  prompts: { zh: "中文提示词", en: "English prompt" },
  metadata: { model: "test-model", elapsedMs: 1250, totalTokens: 42, createdAt: "2026-01-01T00:00:00Z" },
};

describe("bridge helpers", () => {
  it("exports both prompt languages to markdown", () => {
    const markdown = toMarkdown(result);
    expect(markdown).toContain("## 中文提示词");
    expect(markdown).toContain("## 英文提示词");
    expect(markdown).toContain(result.prompts.en);
    expect(markdown).not.toContain("参数建议");
  });

  it("normalizes structured command errors", () => {
    expect(getErrorMessage({ code: "timeout", message: "请求超时" })).toBe("请求超时");
    expect(getErrorMessage("网络错误")).toBe("网络错误");
  });
});
