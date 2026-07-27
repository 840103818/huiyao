import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptPanel } from "./PromptPanel";
import type { ReverseResult } from "../../shared/contracts";

const bridgeMocks = vi.hoisted(() => ({
  runPromptOptimization: vi.fn(),
  cancelReversePrompt: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../infrastructure/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infrastructure/tauri")>()),
  runPromptOptimization: bridgeMocks.runPromptOptimization,
  cancelReversePrompt: bridgeMocks.cancelReversePrompt,
}));

const result: ReverseResult = {
  analysis: { subject: "主体", scene: "场景背景", composition: "构图", lighting: "光线", tonality: "影调曝光", colors: "色彩", palette: [], materials: "材质", style: "风格", camera: "镜头成像", postProcessing: "后期处理" },
  prompts: { zh: "中文提示词", en: "English prompt" },
  metadata: { model: "test-model", elapsedMs: 100, totalTokens: 12, createdAt: "2026-01-01T00:00:00Z" },
};

describe("PromptPanel", () => {
  beforeEach(() => {
    bridgeMocks.runPromptOptimization.mockReset();
    bridgeMocks.cancelReversePrompt.mockClear();
  });
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
    fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
    expect(onCopy).toHaveBeenCalledWith("部分");
    expect(screen.getByRole("button", { name: "导出" })).toBeDisabled();
  });

  it("opens the platform optimization drawer without requiring the source image", () => {
    render(<PromptPanel result={result} generationState="complete" isFinal canRegenerate={false} aspectRatio="3:2" onCopy={vi.fn()} onRegenerate={vi.fn()} onExport={vi.fn()} onResultChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "优化" }));
    expect(screen.getByText("提示词二次优化")).toBeInTheDocument();
    expect(screen.getByText("Midjourney")).toBeInTheDocument();
    expect(screen.getByText("SDXL")).toBeInTheDocument();
    expect(screen.getByText("3:2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始优化" })).toBeEnabled();
  });

  it("shows real bilingual optimization output facts while the request is streaming", async () => {
    let resolveOptimization: (value: { prompts: { zh: string; en: string }; negativePrompts: { zh: string; en: string }; metadata: ReverseResult["metadata"] }) => void = () => undefined;
    bridgeMocks.runPromptOptimization.mockImplementation((_request, onEvent) => {
      if (typeof onEvent !== "function") return Promise.resolve({
        prompts: { zh: "优化中文", en: "optimized English" },
        negativePrompts: { zh: "", en: "" },
        metadata: result.metadata,
      });
      onEvent({ type: "started", interactionId: "opt-1" });
      onEvent({ type: "delta", content: JSON.stringify({ negativePrompts: { zh: "避免模糊", en: "avoid blur" }, prompts: { zh: "优化中文", en: "optimized English" } }) });
      return new Promise((resolve) => { resolveOptimization = resolve; });
    });
    const onResultChange = vi.fn().mockResolvedValue(undefined);
    render(<PromptPanel result={result} generationState="complete" isFinal canRegenerate onCopy={vi.fn()} onRegenerate={vi.fn()} onExport={vi.fn()} onResultChange={onResultChange} />);
    fireEvent.click(screen.getByRole("button", { name: "优化" }));
    fireEvent.click(screen.getByRole("button", { name: "开始优化" }));

    expect(await screen.findByText("生成双语", { selector: ".processing-current" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/已接收 \d+ 字符/)).toBeInTheDocument();
      const languageIndicators = document.querySelectorAll(".processing-languages i");
      expect(languageIndicators[0]).toHaveClass("is-ready");
      expect(languageIndicators[1]).toHaveClass("is-ready");
    }, { timeout: 3_000 });
    expect(onResultChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("提示词正文")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("提示词正文")).toHaveAttribute("aria-live", "off");

    fireEvent.click(screen.getByText("英文提示词"));
    await waitFor(() => expect(screen.getByLabelText("提示词正文")).toHaveTextContent("optimized English"));
    await waitFor(() => expect(screen.getByLabelText("提示词正文")).toHaveTextContent("avoid blur"), { timeout: 3_000 });

    await act(async () => resolveOptimization({
      prompts: { zh: "优化中文", en: "optimized English" },
      negativePrompts: { zh: "避免模糊", en: "avoid blur" },
      metadata: { ...result.metadata, createdAt: "2026-01-01T00:01:00Z" },
    }));
    await waitFor(() => expect(onResultChange).toHaveBeenCalledTimes(1));
  });

  it("flushes received optimization content on stop without creating a version", async () => {
    let rejectOptimization: (reason: unknown) => void = () => undefined;
    bridgeMocks.runPromptOptimization.mockImplementation((_request, onEvent) => {
      if (typeof onEvent !== "function") return Promise.resolve({
        prompts: { zh: "停止前已收到", en: "received before stop" },
        negativePrompts: { zh: "", en: "" },
        metadata: result.metadata,
      });
      onEvent({ type: "started", interactionId: "opt-stop" });
      onEvent({ type: "delta", content: JSON.stringify({ prompts: { zh: "停止前已收到", en: "received before stop" }, negativePrompts: { zh: "", en: "" } }) });
      return new Promise((_resolve, reject) => { rejectOptimization = reject; });
    });
    const onResultChange = vi.fn().mockResolvedValue(undefined);
    render(<PromptPanel result={result} generationState="complete" isFinal canRegenerate onCopy={vi.fn()} onRegenerate={vi.fn()} onExport={vi.fn()} onResultChange={onResultChange} />);
    fireEvent.click(screen.getByRole("button", { name: "优化" }));
    fireEvent.click(screen.getByRole("button", { name: "开始优化" }));
    fireEvent.click(await screen.findByRole("button", { name: "停止优化" }));
    await waitFor(() => expect(bridgeMocks.cancelReversePrompt).toHaveBeenCalledWith("opt-stop"));

    await act(async () => rejectOptimization({ code: "cancelled", message: "已停止优化" }));
    expect(await screen.findByText(/停止前已收到/)).toBeInTheDocument();
    expect(onResultChange).not.toHaveBeenCalled();
  });

  it("keeps the action toolbar as the final row in every output state", () => {
    const props = { onCopy: vi.fn(), onCopyFull: vi.fn(), onRegenerate: vi.fn(), onExport: vi.fn() };
    const { rerender } = render(<PromptPanel result={null} generationState="idle" isFinal={false} canRegenerate={false} {...props} />);

    expectStableToolbar();
    expect(screen.getByText("尚未生成提示词")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制提示词" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "复制完整结果" })).toBeDisabled();

    rerender(<PromptPanel result={{ ...result, prompts: { zh: "部分", en: "" } }} generationState="streaming" isFinal={false} canRegenerate {...props} />);
    expectStableToolbar();
    expect(screen.getByLabelText("提示词正文")).toHaveTextContent("部分");
    expect(screen.getByRole("button", { name: "重新生成" })).toBeDisabled();

    rerender(<PromptPanel result={result} generationState="complete" isFinal canRegenerate {...props} />);
    expectStableToolbar();
    expect(screen.getByRole("button", { name: "复制提示词" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "复制完整结果" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "复制完整结果" }));
    expect(props.onCopyFull).toHaveBeenCalledWith(result);
    expect(screen.getByRole("button", { name: "重新生成" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出" })).toBeEnabled();

    rerender(<PromptPanel result={null} error={{ code: "invalid_response", message: "响应格式无效", diagnosticId: "diag-1" }} generationState="idle" isFinal={false} canRegenerate={false} {...props} />);
    expectStableToolbar();
    expect(screen.getByText("生成失败 · invalid_response")).toBeInTheDocument();
    expect(screen.queryByText("无法解析的原始响应")).not.toBeInTheDocument();
  });

  it("saves manual edits as a derived version without replacing the base result", async () => {
    const onResultChange = vi.fn().mockResolvedValue(undefined);
    render(<PromptPanel result={result} generationState="complete" isFinal canRegenerate onCopy={vi.fn()} onRegenerate={vi.fn()} onExport={vi.fn()} onResultChange={onResultChange} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑提示词副本" }));
    expect(screen.getByText("编辑会创建新的本地派生版本，不会覆盖模型原始结果。")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("手工版本 1"), { target: { value: "精修版本" } });
    fireEvent.change(screen.getByDisplayValue("中文提示词"), { target: { value: "手工修改后的中文提示词" } });
    fireEvent.click(screen.getByRole("button", { name: "保存为新版本" }));

    await waitFor(() => expect(onResultChange).toHaveBeenCalledTimes(1));
    const next = onResultChange.mock.calls[0][0] as ReverseResult;
    expect(next.prompts).toEqual(result.prompts);
    expect(next.promptVersions?.[0]).toMatchObject({ origin: "manual", sourceVersionId: "base", title: "精修版本" });
    expect(next.promptVersions?.[0].prompts.zh).toBe("手工修改后的中文提示词");
  });

  it("keeps manual editor content visible when persistence fails", async () => {
    const onResultChange = vi.fn().mockRejectedValue(new Error("历史文件不可写"));
    render(<PromptPanel result={result} generationState="complete" isFinal canRegenerate onCopy={vi.fn()} onRegenerate={vi.fn()} onExport={vi.fn()} onResultChange={onResultChange} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑提示词副本" }));
    fireEvent.change(screen.getByDisplayValue("中文提示词"), { target: { value: "尚未保存的编辑内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存为新版本" }));

    expect(await screen.findByText("保存失败：历史文件不可写")).toBeInTheDocument();
    expect(screen.getByDisplayValue("尚未保存的编辑内容")).toBeInTheDocument();
  });

  it("enforces the shared eight-version limit for editing and optimization", () => {
    const versions = Array.from({ length: 8 }, (_, index) => ({
      id: `version-${index}`, target: "general" as const, origin: "manual" as const, sourceVersionId: "base", title: `版本 ${index + 1}`, requirements: "",
      prompts: { zh: `中文 ${index}`, en: `English ${index}` }, negativePrompts: { zh: "", en: "" }, metadata: result.metadata,
    }));
    render(<PromptPanel result={{ ...result, promptVersions: versions }} generationState="complete" isFinal canRegenerate onCopy={vi.fn()} onRegenerate={vi.fn()} onExport={vi.fn()} onResultChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "编辑提示词副本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "优化" })).toBeDisabled();
  });

  it("opens a stable side-by-side comparison for derived versions", () => {
    const manual: ReverseResult = {
      ...result,
      promptVersions: [{
        id: "manual-1", target: "general", origin: "manual", sourceVersionId: "base", title: "精修版本", requirements: "",
        prompts: { zh: "精修中文", en: "refined English" }, negativePrompts: { zh: "", en: "" }, metadata: result.metadata,
      }],
      activePromptVersionId: "manual-1",
    };
    const onCopy = vi.fn();
    render(<PromptPanel result={manual} generationState="complete" isFinal canRegenerate onCopy={onCopy} onRegenerate={vi.fn()} onExport={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "比较提示词版本" }));
    expect(screen.getByText("提示词版本比较")).toBeInTheDocument();
    expect(screen.getByText("原始反推版本", { selector: ".comparison-column strong" })).toBeInTheDocument();
    expect(screen.getByText("精修版本", { selector: ".comparison-column strong" })).toBeInTheDocument();
    expect(screen.getByText("中文提示词", { selector: ".comparison-column pre" })).toBeInTheDocument();
    expect(screen.getByText("精修中文", { selector: ".comparison-column pre" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制右侧版本" }));
    expect(onCopy).toHaveBeenCalledWith("精修中文");
  });
});

function expectStableToolbar() {
  const toolbar = screen.getByRole("toolbar", { name: "提示词操作" });
  expect(toolbar.parentElement).toHaveClass("code-editor");
  expect(toolbar.parentElement?.lastElementChild).toBe(toolbar);
}
