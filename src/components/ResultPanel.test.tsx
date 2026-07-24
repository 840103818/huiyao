import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultPanel } from "./ResultPanel";
import type { ReverseResult } from "../types";

const result: ReverseResult = {
  analysis: {
    subject: "真实主体",
    composition: "居中构图",
    lighting: "侧光",
    colors: "冷色调",
    palette: ["#101214"],
    materials: "金属",
    style: "产品摄影",
    camera: "微距视角",
  },
  prompts: { zh: "中文提示词", en: "English prompt" },
  metadata: { model: "test-model", elapsedMs: 100, totalTokens: 12, createdAt: "2026-01-01T00:00:00Z" },
};

describe("ResultPanel", () => {
  it("renders the complete analysis structure", () => {
    render(<ResultPanel result={result} generationState="complete" />);
    expect(screen.getByText("视觉测定")).toBeInTheDocument();
    expect(screen.getByText("主体")).toBeInTheDocument();
    expect(screen.getByText("构图")).toBeInTheDocument();
    expect(screen.getByText("镜头")).toBeInTheDocument();
    expect(screen.getByText(result.analysis.subject)).toBeInTheDocument();
    expect(screen.getByText("已识别 7/7 项")).toBeInTheDocument();
    expect(screen.getByText("镜头").closest(".analysis-item")).toHaveClass("camera-field");
  });

  it("renders an explicit empty state before a real request", () => {
    render(<ResultPanel result={null} generationState="idle" />);
    expect(screen.getByText("待测定")).toBeInTheDocument();
    expect(screen.getByText("选择图片并开始反推")).toBeInTheDocument();
  });

  it("updates completion count for partial streaming data", () => {
    render(<ResultPanel result={{ ...result, analysis: { ...result.analysis, materials: "", style: "", camera: "" } }} generationState="streaming" />);
    expect(screen.getByText("已识别 4/7 项")).toBeInTheDocument();
  });
});
