import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReverseResult } from "../../shared/contracts";
import { RevisionBar } from "./RevisionBar";

const result: ReverseResult = {
  analysis: { subject: "原始主体", scene: "场景", composition: "构图", lighting: "光线", tonality: "影调", colors: "色彩", palette: ["#111111"], materials: "材质", style: "风格", camera: "镜头", postProcessing: "后期" },
  prompts: { zh: "中文提示词", en: "English prompt" },
  metadata: { model: "test", elapsedMs: 100, createdAt: "2026-01-01T00:00:00Z" },
};

describe("RevisionBar", () => {
  it("saves analysis edits as a locked local revision without overwriting base", async () => {
    const onResultChange = vi.fn().mockResolvedValue(undefined);
    const view = render(<RevisionBar result={result} isFinal hasApiKey={false} onResultChange={onResultChange} onCopy={vi.fn()} refineRequestId={1} />);
    fireEvent.change(screen.getByDisplayValue("原始主体"), { target: { value: "校正主体" } });
    fireEvent.click(screen.getByRole("button", { name: "保存本地草稿" }));
    await waitFor(() => expect(onResultChange).toHaveBeenCalledTimes(1));
    const next = onResultChange.mock.calls[0][0] as ReverseResult;
    expect(next.analysis.subject).toBe("原始主体");
    expect(next.resultRevisions?.[0]).toMatchObject({ origin: "manualAnalysis", syncState: "local", lockedFields: ["subject"] });
    expect(next.resultRevisions?.[0].analysis.subject).toBe("校正主体");
    view.rerender(<RevisionBar result={next} isFinal hasApiKey={false} onResultChange={onResultChange} onCopy={vi.fn()} refineRequestId={1} />);
    await waitFor(() => expect(screen.queryByText("校正摄影测定")).not.toBeInTheDocument());
  });

  it("keeps AI refinement disabled without a retained image and API key", () => {
    render(<RevisionBar result={result} isFinal hasApiKey={false} onResultChange={vi.fn()} onCopy={vi.fn()} refineRequestId={1} />);
    expect(screen.getByRole("button", { name: "AI 重测未锁定字段" })).toBeDisabled();
    expect(screen.getByText(/当前任务没有可用原图/)).toBeInTheDocument();
  });

  it("shows the dependent revision impact before cascading deletion", async () => {
    const first = {
      id: "revision-1", title: "初次校正", origin: "manualAnalysis" as const,
      analysis: result.analysis, lockedFields: [], prompts: result.prompts,
      negativePrompts: { zh: "", en: "" }, requirements: "", syncState: "local" as const,
      metadata: result.metadata,
    };
    const second = { ...first, id: "revision-2", title: "提示词同步", origin: "promptEdit" as const, sourceRevisionId: first.id };
    const revised: ReverseResult = { ...result, resultRevisions: [first, second], activeResultRevisionId: first.id };
    const onResultChange = vi.fn().mockResolvedValue(undefined);
    render(<RevisionBar result={revised} isFinal hasApiKey onResultChange={onResultChange} onCopy={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "删除当前修订" }));
    expect(await screen.findByText(/同时删除 1 个依赖它的后续修订/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(onResultChange).toHaveBeenCalledTimes(1));
    expect((onResultChange.mock.calls[0][0] as ReverseResult).resultRevisions).toEqual([]);
  });
});
