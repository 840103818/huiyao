import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResultsWorkspace } from "./ResultsWorkspace";
import type { ReverseResult } from "../../shared/contracts";

const result: ReverseResult = {
  analysis: {
    subject: "主体", scene: "场景背景", composition: "构图", lighting: "光线", tonality: "影调曝光", colors: "色彩",
    palette: [], materials: "材质", style: "风格", camera: "镜头成像", postProcessing: "后期处理",
  },
  prompts: { zh: "中文提示词", en: "English prompt" },
  metadata: { model: "test-model", elapsedMs: 100, createdAt: "2026-01-01T00:00:00Z" },
};

const props = {
  result,
  generationState: "complete" as const,
  isFinal: true,
  canRegenerate: true,
  onCopy: vi.fn(),
  onRegenerate: vi.fn(),
  onExport: vi.fn(),
};

describe("ResultsWorkspace", () => {
  it("supports keyboard resizing and restoring adaptive layout", () => {
    const { container } = render(<ResultsWorkspace {...props} />);
    const column = container.querySelector<HTMLElement>(".result-column")!;
    Object.defineProperty(column, "clientHeight", { configurable: true, value: 700 });
    const divider = screen.getByRole("separator", { name: "调整摄影测定和提示词区域高度" });

    fireEvent.keyDown(divider, { key: "ArrowDown" });
    expect(column).toHaveClass("is-manual");
    expect(column.style.getPropertyValue("--analysis-height")).not.toBe("");

    fireEvent.doubleClick(divider);
    expect(column).toHaveClass("is-auto");
  });

  it("exposes the current split as an accessible horizontal separator", () => {
    render(<ResultsWorkspace {...props} />);
    const divider = screen.getByRole("separator");
    expect(divider).toHaveAttribute("aria-orientation", "horizontal");
    expect(divider).toHaveAttribute("aria-valuenow");
  });

  it("automatically gives the prompt more space as its content grows", () => {
    const { container, rerender } = render(<ResultsWorkspace {...props} />);
    const column = container.querySelector<HTMLElement>(".result-column")!;
    Object.defineProperty(column, "clientHeight", { configurable: true, value: 700 });
    container.querySelectorAll<HTMLElement>(".analysis-item").forEach((item) => {
      Object.defineProperty(item, "scrollHeight", { configurable: true, value: 76 });
    });
    const prompt = screen.getByLabelText("提示词正文");
    Object.defineProperty(prompt, "scrollHeight", { configurable: true, value: 180 });

    const shortResult = { ...result, prompts: { ...result.prompts, zh: "短提示词" } };
    rerender(<ResultsWorkspace {...props} result={shortResult} />);
    const shortPromptHeight = Number.parseInt(column.style.getPropertyValue("--analysis-height"), 10);

    Object.defineProperty(prompt, "scrollHeight", { configurable: true, value: 520 });
    const longResult = { ...result, prompts: { ...result.prompts, zh: "长提示词".repeat(200) } };
    rerender(<ResultsWorkspace {...props} result={longResult} />);
    const longPromptHeight = Number.parseInt(column.style.getPropertyValue("--analysis-height"), 10);

    expect(longPromptHeight).toBeLessThan(shortPromptHeight);
    expect(column).toHaveClass("is-auto");
  });

  it("keeps the automatic split stable while streamed content changes", () => {
    const partial = { ...result, prompts: { zh: "部分", en: "" }, metadata: { ...result.metadata, createdAt: "" } };
    const { container, rerender } = render(<ResultsWorkspace {...props} result={null} generationState="idle" isFinal={false} />);
    const column = container.querySelector<HTMLElement>(".result-column")!;
    Object.defineProperty(column, "clientHeight", { configurable: true, value: 700 });

    rerender(<ResultsWorkspace {...props} result={partial} generationState="connecting" isFinal={false} />);
    const initialHeight = column.style.getPropertyValue("--analysis-height");
    expect(initialHeight).not.toBe("");
    rerender(<ResultsWorkspace {...props} result={partial} generationState="streaming" isFinal={false} />);
    rerender(<ResultsWorkspace {...props} result={{ ...partial, prompts: { zh: "流式内容".repeat(200), en: "" } }} generationState="streaming" isFinal={false} />);

    expect(column.style.getPropertyValue("--analysis-height")).toBe(initialHeight);
    expect(column).toHaveClass("is-auto");
  });
});
