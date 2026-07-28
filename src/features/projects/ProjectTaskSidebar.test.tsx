import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectTask } from "../../shared/contracts";
import { ProjectTaskSidebar } from "./ProjectTaskSidebar";

const task: ProjectTask = {
  id: "task-1", projectId: "project-1", title: "棚拍产品", fileName: "product.jpg",
  thumbnail: "data:image/jpeg;base64,thumb", status: "ready", favorite: false, tags: ["商业"],
  originalImage: { fileName: "product.jpg", mimeType: "image/jpeg", size: 1024, storedAt: "2026-07-26T00:00:00Z", encryptionVersion: 1 },
  queuePosition: 0, createdAt: "2026-07-26T00:00:00Z", updatedAt: "2026-07-26T00:00:00Z",
};

function renderSidebar(overrides: Record<string, unknown> = {}) {
  const props = {
    projects: [{ id: "project-1", title: "我的项目", taskCount: 1, completedCount: 0, createdAt: "", updatedAt: "" }],
    activeProjectId: "project-1", tasks: [task], total: 1, activeTaskId: undefined, selectedTaskIds: [], query: "", filter: "all" as const,
    presets: [{ id: "preset-standard", title: "标准反推", builtIn: true, snapshot: { requirements: "", outputLanguage: "chinese" as const, detailLevel: "expert" as const, autoOptimizeRequirements: "" }, createdAt: "", updatedAt: "" }],
    activePresetId: "preset-standard", progress: { total: 1, ready: 1, queued: 0, running: 0, completed: 0, failed: 0, paused: 0 },
    queueRunning: false, queuePaused: false, importing: false, trash: [], onProjectChange: vi.fn(), onCreateProject: vi.fn(), onRenameProject: vi.fn(), onDeleteProject: vi.fn(), onQueryChange: vi.fn(), onFilterChange: vi.fn(), onPresetChange: vi.fn(), onSavePreset: vi.fn(), onDeletePreset: vi.fn(), onImport: vi.fn(), onCancelImport: vi.fn(), onSelectTask: vi.fn(), onSelectionChange: vi.fn(), onFavorite: vi.fn(), onTags: vi.fn(), onRenameTask: vi.fn(), onRetryTask: vi.fn(), onBatchFavorite: vi.fn(), onBatchTags: vi.fn(), onDuplicate: vi.fn(), onDeleteTasks: vi.fn(), onReorder: vi.fn(), onMove: vi.fn(), onStartQueue: vi.fn(), onPauseQueue: vi.fn(), onStopQueue: vi.fn(), onRetryFailed: vi.fn(), onLoadMore: vi.fn(), onExport: vi.fn(), onRestoreTrash: vi.fn(), onDeleteTrash: vi.fn(), onEmptyTrash: vi.fn(),
    ...overrides,
  };
  render(<ProjectTaskSidebar {...props} />);
  return props;
}

describe("ProjectTaskSidebar", () => {
  it("selects a task without losing its original-retained state", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByText("棚拍产品"));
    expect(props.onSelectTask).toHaveBeenCalledWith(task);
    expect(screen.getByText("原图")).toBeInTheDocument();
  });

  it("accepts a local multi-image selection", () => {
    const props = renderSidebar();
    const input = document.querySelector<HTMLInputElement>('.project-import input[type="file"]')!;
    const files = [new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.png", { type: "image/png" })];
    fireEvent.change(input, { target: { files } });
    expect(props.onImport).toHaveBeenCalledWith(files);
  });

  it("keeps completed-task export available when list summaries omit the result", async () => {
    renderSidebar({ tasks: [{ ...task, status: "completed", result: undefined }] });
    fireEvent.click(screen.getByRole("button", { name: "棚拍产品 操作" }));
    expect(await screen.findByText("导出任务")).not.toHaveClass("arco-menu-disabled");
  });

  it("shows batch tools only after selecting tasks while keeping import visible", () => {
    renderSidebar();
    expect(screen.queryByLabelText("批量导出")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入图片" })).toBeInTheDocument();

    cleanup();
    renderSidebar({ selectedTaskIds: [task.id] });
    expect(screen.getByLabelText("批量导出")).toBeInTheDocument();
  });

  it("exposes rename and single-task retry from the task menu", async () => {
    const failed = { ...task, status: "failed" as const };
    const props = renderSidebar({ tasks: [failed] });
    fireEvent.click(screen.getByRole("button", { name: "棚拍产品 操作" }));
    fireEvent.click(await screen.findByText("重命名任务"));
    fireEvent.change(screen.getByDisplayValue("棚拍产品"), { target: { value: "精修产品" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(props.onRenameTask).toHaveBeenCalledWith(failed, "精修产品"));

    fireEvent.click(screen.getByRole("button", { name: "棚拍产品 操作" }));
    fireEvent.click(await screen.findByText("重试此任务"));
    expect(props.onRetryTask).toHaveBeenCalledWith(failed);
  });

  it("keeps batch favorite and tag actions contextual to the current selection", async () => {
    const props = renderSidebar({ selectedTaskIds: [task.id] });
    fireEvent.click(screen.getByRole("button", { name: "批量整理" }));
    fireEvent.click(await screen.findByText("收藏"));
    expect(props.onBatchFavorite).toHaveBeenCalledWith([task.id], true);

    fireEvent.click(screen.getByRole("button", { name: "批量整理" }));
    fireEvent.click(await screen.findByText("添加标签"));
    fireEvent.change(screen.getByPlaceholderText("使用逗号分隔标签"), { target: { value: "商业, 精修" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(props.onBatchTags).toHaveBeenCalledWith([task.id], ["商业", "精修"], false));
  });
});
