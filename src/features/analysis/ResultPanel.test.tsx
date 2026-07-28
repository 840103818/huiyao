import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultPanel } from "./ResultPanel";
import type { ReverseResult } from "../../shared/contracts";

const result: ReverseResult = {
  analysis: {
    subject: "真实主体",
    scene: "室内暗色背景",
    composition: "居中构图",
    lighting: "侧光",
    tonality: "低调高对比",
    colors: "冷色调",
    palette: ["#101214"],
    materials: "金属",
    style: "产品摄影",
    camera: "微距视角",
    postProcessing: "冷色调色",
  },
  prompts: { zh: "中文提示词", en: "English prompt" },
  metadata: { model: "test-model", elapsedMs: 100, totalTokens: 12, createdAt: "2026-01-01T00:00:00Z" },
};

describe("ResultPanel", () => {
  it("renders the complete analysis structure", () => {
    render(<ResultPanel result={result} generationState="complete" />);
    expect(screen.getByText("摄影测定")).toBeInTheDocument();
    expect(screen.getByText("画面", { selector: ".analysis-group-heading" })).toBeInTheDocument();
    expect(screen.getByText("光影", { selector: ".analysis-group-heading" })).toBeInTheDocument();
    expect(screen.getByText("成像", { selector: ".analysis-group-heading" })).toBeInTheDocument();
    expect(screen.getByText("主体")).toBeInTheDocument();
    expect(screen.getByText("场景背景")).toBeInTheDocument();
    expect(screen.getByText("构图")).toBeInTheDocument();
    expect(screen.getByText("影调曝光")).toBeInTheDocument();
    expect(screen.getByText("镜头成像")).toBeInTheDocument();
    expect(screen.getByText("后期处理")).toBeInTheDocument();
    expect(screen.getByText(result.analysis.subject)).toBeInTheDocument();
    expect(screen.getByText("10/10")).toBeInTheDocument();
    const rows = document.querySelectorAll(".analysis-item");
    expect(rows).toHaveLength(10);
    expect(Array.from(rows).map((row) => row.getAttribute("data-analysis-key"))).toEqual([
      "subject", "scene", "composition", "lighting", "tonality", "colors", "materials", "style", "camera", "postProcessing",
    ]);
    expect(screen.getByLabelText("识别色板")).toBeInTheDocument();
  });

  it("renders an explicit empty state before a real request", () => {
    render(<ResultPanel result={null} generationState="idle" />);
    expect(screen.getByText("待测定")).toBeInTheDocument();
    expect(screen.getByText("选择图片并开始反推")).toBeInTheDocument();
  });

  it("distinguishes local EXIF facts from AI visual inference", () => {
    render(<ResultPanel result={result} generationState="complete" captureMetadata={{ cameraModel: "ILCE-7RM5", lensModel: "FE 50mm F1.2 GM", iso: "100" }} />);
    expect(screen.getByText("AI 视觉推断")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "摄影测定更多操作" }));
    fireEvent.click(screen.getByText(/文件实拍信息/));
    expect(screen.getByText("ILCE-7RM5")).toBeInTheDocument();
    expect(screen.getByText("FE 50mm F1.2 GM")).toBeInTheDocument();
    expect(screen.getByText(/GPS、序列号、作者和版权字段不会保存/)).toBeInTheDocument();
  });

  it("updates completion count for partial streaming data", () => {
    render(<ResultPanel result={{ ...result, analysis: { ...result.analysis, materials: "", style: "", camera: "", postProcessing: "" } }} generationState="streaming" />);
    expect(screen.getByText("6/10")).toBeInTheDocument();
  });

  it("moves the printing cursor with the growing analysis field and removes it during prompt output", async () => {
    const partial = {
      ...result,
      analysis: { ...result.analysis, subject: "主", scene: "", composition: "", lighting: "", tonality: "", colors: "", palette: [], materials: "", style: "", camera: "", postProcessing: "" },
      prompts: { zh: "", en: "" },
    };
    const { rerender } = render(<ResultPanel result={partial} generationState="streaming" />);
    const grid = document.querySelector(".analysis-grid");

    expect(grid).toHaveAttribute("aria-busy", "true");
    expect(grid).toHaveAttribute("aria-live", "off");
    await waitFor(() => expect(document.querySelector('[data-analysis-key="subject"]')).toHaveClass("is-printing"));

    const growingScene = { ...partial, analysis: { ...partial.analysis, subject: "主体", scene: "暗" } };
    rerender(<ResultPanel result={growingScene} generationState="streaming" />);
    await waitFor(() => expect(document.querySelector('[data-analysis-key="scene"]')).toHaveClass("is-printing"));
    expect(document.querySelector('[data-analysis-key="subject"]')).not.toHaveClass("is-printing");

    rerender(<ResultPanel result={{ ...growingScene, prompts: { zh: "提示", en: "" } }} generationState="streaming" />);
    await waitFor(() => expect(document.querySelector(".analysis-item.is-printing")).not.toBeInTheDocument());

    rerender(<ResultPanel result={result} generationState="complete" />);
    expect(grid).toHaveAttribute("aria-busy", "false");
    expect(grid).toHaveAttribute("aria-live", "polite");
  });

  it("将长文测定值保留在各自的独立行内", () => {
    const longResult = {
      ...result,
      analysis: {
        ...result.analysis,
        subject: "长主体描述".repeat(80),
        composition: "长构图描述".repeat(80),
      },
    };
    const { rerender } = render(<ResultPanel result={longResult} generationState="complete" />);

    const subject = screen.getByText(longResult.analysis.subject);
    const composition = screen.getByText(longResult.analysis.composition);
    expect(subject.closest(".analysis-item")).toHaveAttribute("data-analysis-key", "subject");
    expect(composition.closest(".analysis-item")).toHaveAttribute("data-analysis-key", "composition");
    expect(subject.closest(".analysis-item")).not.toBe(composition.closest(".analysis-item"));
    expect(screen.getByLabelText("识别色板").closest(".analysis-value")).toHaveClass("has-palette");
    expect(subject).not.toHaveClass("is-expanded");

    fireEvent.click(screen.getByRole("button", { name: "展开主体全文" }));
    expect(subject).toHaveClass("is-expanded");
    expect(screen.getByRole("button", { name: "收起主体内容" })).toHaveAttribute("aria-expanded", "true");

    rerender(<ResultPanel result={{ ...longResult, metadata: { ...longResult.metadata, createdAt: "2026-01-02T00:00:00Z" } }} generationState="complete" />);
    expect(screen.getByText(longResult.analysis.subject)).not.toHaveClass("is-expanded");

    fireEvent.click(screen.getByRole("button", { name: "摄影测定更多操作" }));
    fireEvent.click(screen.getByText("展开全部"));
    expect(subject).toHaveClass("is-expanded");
    expect(composition).toHaveClass("is-expanded");
    fireEvent.click(screen.getByRole("button", { name: "摄影测定更多操作" }));
    fireEvent.click(screen.getByText("收起全部"));
    expect(subject).not.toHaveClass("is-expanded");
    expect(composition).not.toHaveClass("is-expanded");
  });
});
