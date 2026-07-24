import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptPanel } from "./PromptPanel";
import type { ReverseResult } from "../types";

const result: ReverseResult = {
  analysis: { subject: "主体", composition: "构图", lighting: "光线", colors: "色彩", palette: [], materials: "材质", style: "风格", camera: "镜头" },
  prompts: { zh: "中文提示词", en: "English prompt" },
  metadata: { model: "test-model", elapsedMs: 100, totalTokens: 12, createdAt: "2026-01-01T00:00:00Z" },
};

describe("PromptPanel", () => {
  it("uses localized tabs and reports the active prompt character count", () => {
    render(<PromptPanel result={result} generationState="complete" isFinal canRegenerate onCopy={vi.fn()} onRegenerate={vi.fn()} onExport={vi.fn()} />);
    expect(screen.getByText("共 5 字")).toBeInTheDocument();

    fireEvent.click(screen.getByText("英文提示词"));
    expect(screen.getByText("English prompt", { selector: "pre" })).toBeInTheDocument();
    expect(screen.getByText("共 14 字")).toBeInTheDocument();
  });

  it("keeps copy available for partial streamed output", () => {
    const onCopy = vi.fn();
    render(<PromptPanel result={{ ...result, prompts: { zh: "部分", en: "" } }} generationState="streaming" isFinal={false} canRegenerate onCopy={onCopy} onRegenerate={vi.fn()} onExport={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(onCopy).toHaveBeenCalledWith("部分");
    expect(screen.getByRole("button", { name: "导出" })).toBeDisabled();
  });

  it("keeps the action toolbar as the final row in every output state", () => {
    const props = { onCopy: vi.fn(), onRegenerate: vi.fn(), onExport: vi.fn() };
    const { rerender } = render(<PromptPanel result={null} generationState="idle" isFinal={false} canRegenerate={false} {...props} />);

    expectStableToolbar();
    expect(screen.getByText("尚未生成提示词")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制" })).toBeDisabled();

    rerender(<PromptPanel result={{ ...result, prompts: { zh: "部分", en: "" } }} generationState="streaming" isFinal={false} canRegenerate {...props} />);
    expectStableToolbar();
    expect(screen.getByLabelText("提示词正文")).toHaveTextContent("部分");
    expect(screen.getByRole("button", { name: "重新生成" })).toBeDisabled();

    rerender(<PromptPanel result={result} generationState="complete" isFinal canRegenerate {...props} />);
    expectStableToolbar();
    expect(screen.getByRole("button", { name: "复制" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "重新生成" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出" })).toBeEnabled();

    rerender(<PromptPanel result={null} rawResponse="无法解析的原始响应" generationState="idle" isFinal={false} canRegenerate={false} {...props} />);
    expectStableToolbar();
    expect(screen.getByLabelText("原始响应")).toHaveClass("raw-response");
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(props.onCopy).toHaveBeenCalledWith("无法解析的原始响应");
  });
});

function expectStableToolbar() {
  const toolbar = screen.getByRole("toolbar", { name: "提示词操作" });
  expect(toolbar.parentElement).toHaveClass("code-editor");
  expect(toolbar.parentElement?.lastElementChild).toBe(toolbar);
}
