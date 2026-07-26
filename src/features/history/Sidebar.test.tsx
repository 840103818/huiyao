import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import type { HistoryItem } from "../../shared/contracts";

const item: HistoryItem = {
  id: "history-1",
  title: "旧标题",
  inputSummary: "sample.png",
  thumbnail: "data:image/jpeg;base64,thumb",
  result: {
    analysis: { subject: "主体", scene: "场景背景", composition: "构图", lighting: "光线", tonality: "影调曝光", colors: "色彩", palette: [], materials: "材质", style: "风格", camera: "镜头成像", postProcessing: "后期处理" },
    prompts: { zh: "中文提示词", en: "English prompt" },
    metadata: { model: "test-model", elapsedMs: 100, totalTokens: 12, createdAt: "2026-01-01T00:00:00Z" },
  },
  createdAt: "2026-01-01T00:00:00Z",
};

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props: React.ComponentProps<typeof Sidebar> = {
    items: [item],
    query: "",
    onQueryChange: vi.fn(),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onCopy: vi.fn(),
    onRename: vi.fn().mockResolvedValue(undefined),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

describe("Sidebar history context actions", () => {
  it("opens by right click without restoring the task and copies each result form", async () => {
    const props = renderSidebar();
    const row = screen.getByLabelText("历史任务：旧标题");
    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });
    expect(await screen.findByText("复制中文提示词")).toBeInTheDocument();
    expect(props.onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("复制中文提示词"));
    expect(props.onCopy).toHaveBeenCalledWith(item, "zh");

    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });
    fireEvent.click(await screen.findByText("复制英文提示词"));
    expect(props.onCopy).toHaveBeenCalledWith(item, "en");

    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });
    fireEvent.click(await screen.findByText("复制完整结果"));
    expect(props.onCopy).toHaveBeenCalledWith(item, "all");
  });

  it("trims and persists a renamed title", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderSidebar({ onRename });
    fireEvent.contextMenu(screen.getByLabelText("历史任务：旧标题"), { clientX: 20, clientY: 20 });
    fireEvent.click(await screen.findByText("修改标题"));

    const input = await screen.findByLabelText("历史任务标题");
    fireEvent.change(input, { target: { value: "  新标题  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("history-1", "新标题"));
    await waitFor(() => expect(screen.queryByLabelText("历史任务标题")).not.toBeInTheDocument());
  });

  it("opens the same context menu from Shift F10", async () => {
    renderSidebar();
    fireEvent.keyDown(screen.getByLabelText("历史任务：旧标题"), { key: "F10", shiftKey: true });
    expect(await screen.findByText("复制完整结果")).toBeInTheDocument();
  });

  it("disables copying when the matching language is missing", async () => {
    const props = renderSidebar({
      items: [{ ...item, result: { ...item.result, prompts: { zh: item.result.prompts.zh, en: "" } } }],
    });
    fireEvent.contextMenu(screen.getByLabelText("历史任务：旧标题"), { clientX: 20, clientY: 20 });

    const englishCopy = await screen.findByText("复制英文提示词");
    fireEvent.click(englishCopy);
    expect(props.onCopy).not.toHaveBeenCalled();
  });

  it("keeps rename content when persistence fails", async () => {
    renderSidebar({ onRename: vi.fn().mockRejectedValue(new Error("write failed")) });
    fireEvent.contextMenu(screen.getByLabelText("历史任务：旧标题"), { clientX: 20, clientY: 20 });
    fireEvent.click(await screen.findByText("修改标题"));
    const input = await screen.findByLabelText("历史任务标题");
    fireEvent.change(input, { target: { value: "待重试标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByLabelText("历史任务标题")).toHaveValue("待重试标题"));
  });
});
