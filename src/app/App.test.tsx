import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { PreparedImage, ProjectTask, PublicSettings, ReversePreset, ReverseResult } from "../shared/contracts";

const mocks = vi.hoisted(() => ({
  applyNativeTheme: vi.fn().mockResolvedValue(undefined),
  cancelReversePrompt: vi.fn().mockResolvedValue(true),
  getSettings: vi.fn(),
  loadHistory: vi.fn().mockResolvedValue([]),
  persistHistory: vi.fn().mockResolvedValue(undefined),
  runReversePrompt: vi.fn(),
  runPromptOptimization: vi.fn(),
  saveTheme: vi.fn(),
  saveWorkspacePreferences: vi.fn(),
  prepareImage: vi.fn(),
  isDesktopApp: vi.fn().mockReturnValue(false),
  listProjects: vi.fn(),
  listProjectTasks: vi.fn(),
  listReversePresets: vi.fn(),
  listTrash: vi.fn(),
  getBatchProgress: vi.fn(),
  getProjectTask: vi.fn(),
  loadWorkspaceOriginalImage: vi.fn(),
  updateProjectTaskResult: vi.fn(),
  updateProjectTaskStatus: vi.fn().mockResolvedValue(0),
  completeProjectTask: vi.fn().mockResolvedValue(undefined),
  failProjectTask: vi.fn().mockResolvedValue(undefined),
  duplicateProjectTask: vi.fn(),
  saveWorkspaceSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../infrastructure/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infrastructure/tauri")>();
  return {
    ...actual,
    applyNativeTheme: mocks.applyNativeTheme,
    cancelReversePrompt: mocks.cancelReversePrompt,
    getSettings: mocks.getSettings,
    loadHistory: mocks.loadHistory,
    persistHistory: mocks.persistHistory,
    runReversePrompt: mocks.runReversePrompt,
    runPromptOptimization: mocks.runPromptOptimization,
    saveTheme: mocks.saveTheme,
    saveWorkspacePreferences: mocks.saveWorkspacePreferences,
    isDesktopApp: mocks.isDesktopApp,
    listProjects: mocks.listProjects,
    listProjectTasks: mocks.listProjectTasks,
    listReversePresets: mocks.listReversePresets,
    listTrash: mocks.listTrash,
    getBatchProgress: mocks.getBatchProgress,
    getProjectTask: mocks.getProjectTask,
    loadWorkspaceOriginalImage: mocks.loadWorkspaceOriginalImage,
    updateProjectTaskResult: mocks.updateProjectTaskResult,
    updateProjectTaskStatus: mocks.updateProjectTaskStatus,
    completeProjectTask: mocks.completeProjectTask,
    failProjectTask: mocks.failProjectTask,
    duplicateProjectTask: mocks.duplicateProjectTask,
    saveWorkspaceSession: mocks.saveWorkspaceSession,
  };
});

vi.mock("../features/image-input/image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/image-input/image")>();
  return { ...actual, prepareImage: mocks.prepareImage };
});

const settings: PublicSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "vision-model",
  timeoutSeconds: 120,
  theme: "light",
  hasApiKey: true,
  autoSaveHistory: true,
  workspace: { outputLanguage: "chinese", detailLevel: "expert", fitMode: "contain" },
  batchConcurrency: 1,
  storageQuotaBytes: 10 * 1024 * 1024 * 1024,
  progressiveDisclosure: true,
};

const image: PreparedImage = {
  name: "sample.png",
  previewUrl: "data:image/png;base64,preview",
  modelDataUrl: "data:image/png;base64,model",
  thumbnail: "data:image/jpeg;base64,thumb",
  width: 1200,
  height: 800,
  size: 2048,
  mimeType: "image/png",
};

const result: ReverseResult = {
  analysis: {
    subject: "机械钥匙",
    scene: "暗色影棚背景",
    composition: "居中构图",
    lighting: "轮廓光",
    tonality: "低调高对比",
    colors: "黑色与荧光绿",
    palette: ["#111315", "#b9ef2c"],
    materials: "钛金属",
    style: "精密仪器",
    camera: "微距视角",
    postProcessing: "冷色数字调色",
  },
  prompts: { zh: "中文提示词", en: "English prompt" },
  metadata: { model: "vision-model", elapsedMs: 240, totalTokens: 42, createdAt: "2026-07-24T00:00:00Z" },
};

function configureDesktopProject(): ProjectTask {
  const preset: ReversePreset = {
    id: "preset-1",
    title: "标准反推",
    builtIn: true,
    snapshot: { requirements: "", outputLanguage: "chinese", detailLevel: "expert", autoOptimizeRequirements: "" },
    createdAt: "2026-07-24T00:00:00Z",
    updatedAt: "2026-07-24T00:00:00Z",
  };
  const task: ProjectTask = {
    id: "task-completed",
    projectId: "project-1",
    title: "棚拍产品",
    fileName: "sample.png",
    thumbnail: image.thumbnail,
    imageInfo: image,
    originalImage: { fileName: "sample.png", mimeType: "image/png", size: image.size, storedAt: "2026-07-24T00:00:00Z", encryptionVersion: 1 },
    status: "completed",
    favorite: true,
    tags: ["商业"],
    presetSnapshot: preset.snapshot,
    result,
    queuePosition: 0,
    createdAt: "2026-07-24T00:00:00Z",
    updatedAt: "2026-07-24T00:00:00Z",
  };
  mocks.isDesktopApp.mockReturnValue(true);
  mocks.listProjects.mockResolvedValue([{ id: "project-1", title: "我的项目", taskCount: 1, completedCount: 1, createdAt: "", updatedAt: "" }]);
  mocks.listProjectTasks.mockResolvedValue({ items: [task], total: 1 });
  mocks.listReversePresets.mockResolvedValue([preset]);
  mocks.listTrash.mockResolvedValue([]);
  mocks.getBatchProgress.mockResolvedValue({ total: 1, ready: 0, queued: 0, running: 0, completed: 1, failed: 0, paused: 0 });
  mocks.getProjectTask.mockResolvedValue(task);
  mocks.loadWorkspaceOriginalImage.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.updateProjectTaskResult.mockResolvedValue(undefined);
  return task;
}

function configureDesktopQueue(taskCount: number, concurrency: 1 | 2 = 1, autoOptimize = false): ProjectTask[] {
  const tasks = Array.from({ length: taskCount }, (_, index): ProjectTask => ({
    id: `task-${index + 1}`,
    projectId: "project-1",
    title: `待分析图片 ${index + 1}`,
    fileName: `sample-${index + 1}.png`,
    thumbnail: image.thumbnail,
    imageInfo: image,
    originalImage: { fileName: `sample-${index + 1}.png`, mimeType: "image/png", size: image.size, storedAt: "2026-07-24T00:00:00Z", encryptionVersion: 1 },
    status: "ready",
    favorite: false,
    tags: [],
    presetSnapshot: { requirements: "", outputLanguage: "chinese", detailLevel: "expert", autoOptimizeTarget: autoOptimize ? "flux" : undefined, autoOptimizeRequirements: "" },
    queuePosition: index,
    createdAt: "2026-07-24T00:00:00Z",
    updatedAt: "2026-07-24T00:00:00Z",
  }));
  mocks.isDesktopApp.mockReturnValue(true);
  mocks.getSettings.mockResolvedValue({ ...settings, batchConcurrency: concurrency, lastProjectId: "project-1" });
  mocks.listProjects.mockResolvedValue([{ id: "project-1", title: "我的项目", taskCount, completedCount: 0, createdAt: "", updatedAt: "" }]);
  mocks.listProjectTasks.mockImplementation(async () => ({ items: tasks, total: tasks.length }));
  mocks.listReversePresets.mockResolvedValue([]);
  mocks.listTrash.mockResolvedValue([]);
  mocks.getBatchProgress.mockResolvedValue({ total: taskCount, ready: taskCount, queued: 0, running: 0, completed: 0, failed: 0, paused: 0 });
  mocks.loadWorkspaceOriginalImage.mockResolvedValue(new Uint8Array([1, 2, 3]));
  return tasks;
}

describe("App image reverse workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue(settings);
    mocks.loadHistory.mockResolvedValue([]);
    mocks.prepareImage.mockResolvedValue(image);
    mocks.isDesktopApp.mockReturnValue(false);
    mocks.runPromptOptimization.mockResolvedValue({ prompts: result.prompts, negativePrompts: { zh: "", en: "" }, metadata: result.metadata });
    mocks.updateProjectTaskStatus.mockResolvedValue(0);
    mocks.completeProjectTask.mockResolvedValue(undefined);
    mocks.failProjectTask.mockResolvedValue(undefined);
    mocks.saveTheme.mockImplementation(async (theme) => ({ ...settings, theme }));
    mocks.saveWorkspacePreferences.mockImplementation(async (workspace) => ({ ...settings, workspace }));
  });

  it("renders stream deltas and saves only the final result", async () => {
    mocks.runReversePrompt.mockImplementation(async (_request, onEvent) => {
      onEvent({ type: "started", interactionId: "req-stream" });
      onEvent({ type: "delta", content: "{\"analysis\":{\"subject\":\"机械钥匙\"},\"prompts\":{\"zh\":\"中文" });
      onEvent({ type: "delta", content: "提示词\",\"en\":\"English prompt\"}}" });
      return result;
    });
    render(<App />);

    await chooseImage();
    fireEvent.click(screen.getByRole("button", { name: "开始反推" }));

    expect(await screen.findByText("机械钥匙")).toBeInTheDocument();
    expect(await screen.findByText("中文提示词", { selector: "pre" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.persistHistory).toHaveBeenCalledTimes(1));
    expect(mocks.runReversePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ outputLanguage: "chinese" }),
      expect.any(Function),
    );
  });

  it("imports a clipboard image through the same image preparation pipeline", async () => {
    render(<App />);
    const file = new File([new Uint8Array([1, 2, 3])], "clipboard.png", { type: "image/png" });
    fireEvent.paste(window, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      },
    });

    await waitFor(() => expect(mocks.prepareImage).toHaveBeenCalledTimes(1));
    const preparedFile = mocks.prepareImage.mock.calls[0][0] as File;
    expect(preparedFile.name).toMatch(/^剪贴板-\d{8}-\d{6}\.png$/);
    expect(await screen.findByText("sample.png")).toBeInTheDocument();
  });

  it("keeps partial output but does not save history after stopping", async () => {
    let rejectRequest: (reason: unknown) => void = () => undefined;
    mocks.runReversePrompt.mockImplementation((_request, onEvent) => {
      onEvent({ type: "started", interactionId: "req-cancel" });
      onEvent({ type: "delta", content: "{\"analysis\":{\"subject\":\"部分结果\"}" });
      return new Promise((_resolve, reject) => { rejectRequest = reject; });
    });
    render(<App />);

    await chooseImage();
    fireEvent.click(screen.getByRole("button", { name: "开始反推" }));
    fireEvent.click(await screen.findByRole("button", { name: "停止生成" }));
    await waitFor(() => expect(mocks.cancelReversePrompt).toHaveBeenCalledWith("req-cancel"));
    rejectRequest({ code: "cancelled", message: "已停止生成" });

    expect(await screen.findByText("部分结果")).toBeInTheDocument();
    await screen.findByText("生成已停止");
    expect(mocks.persistHistory).not.toHaveBeenCalled();
  });

  it("latches stop before started and cancels a late interaction only once", async () => {
    let emitEvent: ((event: { type: "started"; interactionId: string }) => void) | undefined;
    let rejectRequest: (reason: unknown) => void = () => undefined;
    mocks.runReversePrompt.mockImplementation((_request, onEvent) => {
      emitEvent = onEvent;
      return new Promise((_resolve, reject) => { rejectRequest = reject; });
    });
    render(<App />);

    await chooseImage();
    fireEvent.click(screen.getByRole("button", { name: "开始反推" }));
    const stop = await screen.findByRole("button", { name: "停止生成" });
    expect(screen.getByRole("button", { name: "设置" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "反推参数" })).toBeDisabled();
    expect(screen.getByRole("separator", { name: "调整视觉输入和结果区域宽度" })).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(stop).toHaveTextContent("正在停止");
    emitEvent?.({ type: "started", interactionId: "req-late" });

    await waitFor(() => expect(mocks.cancelReversePrompt).toHaveBeenCalledTimes(1));
    expect(mocks.cancelReversePrompt).toHaveBeenCalledWith("req-late");
    rejectRequest({ code: "cancelled", message: "已停止生成" });
    await screen.findByText("生成已停止");
    expect(screen.getByRole("button", { name: "设置" })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "设置" })).toHaveFocus());
  });

  it("does not invoke the model when stop is requested during task state preparation", async () => {
    const [task] = configureDesktopQueue(1);
    mocks.getProjectTask.mockResolvedValue(task);
    let resolveRunning: () => void = () => undefined;
    let runningReached: () => void = () => undefined;
    const reachedRunning = new Promise<void>((resolve) => { runningReached = resolve; });
    mocks.updateProjectTaskStatus.mockImplementation(async (_ids, status) => {
      if (status !== "running") return 0;
      runningReached();
      await new Promise<void>((resolve) => { resolveRunning = resolve; });
      return 0;
    });
    render(<App />);

    fireEvent.click(await screen.findByLabelText("项目任务：待分析图片 1"));
    fireEvent.click(await screen.findByRole("button", { name: "开始反推" }));
    await reachedRunning;
    fireEvent.click(await screen.findByRole("button", { name: "停止生成" }));
    resolveRunning();

    await screen.findByText("生成已停止");
    expect(mocks.runReversePrompt).not.toHaveBeenCalled();
    expect(mocks.updateProjectTaskStatus).toHaveBeenCalledWith([task.id], "paused");
  });

  it("re-analyzes a completed project task in place without creating a duplicate", async () => {
    const task = configureDesktopProject();
    const nextResult = { ...result, prompts: { zh: "重新分析后的提示词", en: "Updated prompt" } };
    mocks.runReversePrompt.mockResolvedValue(nextResult);
    render(<App />);

    fireEvent.click(await screen.findByLabelText("项目任务：棚拍产品"));
    fireEvent.click((await screen.findAllByRole("button", { name: "重新分析" }))[0]);

    await waitFor(() => expect(mocks.updateProjectTaskResult).toHaveBeenCalledWith(task.id, nextResult));
    expect(mocks.duplicateProjectTask).not.toHaveBeenCalled();
    expect(await screen.findByText("重新分析后的提示词", { selector: "pre" })).toBeInTheDocument();
  });

  it("keeps the previous completed result when in-place re-analysis fails", async () => {
    configureDesktopProject();
    mocks.runReversePrompt.mockRejectedValue({ code: "stream_interrupted", message: "模型流式响应意外中断" });
    render(<App />);

    fireEvent.click(await screen.findByLabelText("项目任务：棚拍产品"));
    expect(await screen.findByText("中文提示词", { selector: "pre" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "重新分析" })[0]);

    expect((await screen.findAllByText("模型流式响应意外中断")).length).toBeGreaterThan(0);
    expect(screen.getByText("中文提示词", { selector: "pre" })).toBeInTheDocument();
    expect(mocks.updateProjectTaskResult).not.toHaveBeenCalled();
    expect(mocks.duplicateProjectTask).not.toHaveBeenCalled();
  });

  it("re-analyzes the selected completed task even when filtering hides its row", async () => {
    const task = configureDesktopProject();
    const nextResult = { ...result, prompts: { zh: "筛选后重新分析", en: "Re-analyzed while filtered" } };
    mocks.runReversePrompt.mockResolvedValue(nextResult);
    render(<App />);

    fireEvent.click(await screen.findByLabelText("项目任务：棚拍产品"));
    mocks.listProjectTasks.mockResolvedValue({ items: [], total: 0 });
    fireEvent.change(screen.getByRole("textbox", { name: "搜索任务" }), { target: { value: "不存在的任务" } });
    await waitFor(() => expect(screen.queryByLabelText("项目任务：棚拍产品")).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "重新分析" })[0]);

    await waitFor(() => expect(mocks.updateProjectTaskResult).toHaveBeenCalledWith(task.id, nextResult));
    expect(mocks.updateProjectTaskStatus).not.toHaveBeenCalledWith([task.id], "queued");
    expect(mocks.duplicateProjectTask).not.toHaveBeenCalled();
  });

  it("does not start a new analysis while prompt optimization is active", async () => {
    configureDesktopProject();
    mocks.runPromptOptimization.mockImplementation((_request, onEvent) => {
      onEvent({ type: "started", interactionId: "optimization-active" });
      return new Promise(() => undefined);
    });
    render(<App />);

    fireEvent.click(await screen.findByLabelText("项目任务：棚拍产品"));
    fireEvent.click(await screen.findByRole("button", { name: "优化" }));
    fireEvent.click(await screen.findByRole("button", { name: "开始优化" }));
    await screen.findByRole("button", { name: "停止优化" });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    await Promise.resolve();
    expect(mocks.runReversePrompt).not.toHaveBeenCalled();
  });

  it("stops both active queue workers without starting a third task", async () => {
    configureDesktopQueue(3, 2);
    const rejectRequests: Array<(reason: unknown) => void> = [];
    mocks.runReversePrompt.mockImplementation((_request, onEvent) => {
      const interactionId = `queue-request-${rejectRequests.length + 1}`;
      onEvent({ type: "started", interactionId });
      return new Promise((_resolve, reject) => { rejectRequests.push(reject); });
    });
    render(<App />);

    fireEvent.click((await screen.findAllByRole("button", { name: "开始队列" }))[0]);
    await waitFor(() => expect(mocks.runReversePrompt).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    await waitFor(() => {
      expect(mocks.cancelReversePrompt).toHaveBeenCalledWith("queue-request-1");
      expect(mocks.cancelReversePrompt).toHaveBeenCalledWith("queue-request-2");
    });
    rejectRequests[0]({ code: "cancelled", message: "已停止生成" });
    await waitFor(() => expect(mocks.updateProjectTaskStatus).toHaveBeenCalledWith(["task-1"], "paused"));
    expect(screen.queryByText("队列已停止")).not.toBeInTheDocument();
    expect(screen.getByText("停止中")).toBeInTheDocument();
    rejectRequests[1]({ code: "cancelled", message: "已停止生成" });

    await screen.findByText("队列已停止");
    expect(mocks.runReversePrompt).toHaveBeenCalledTimes(2);
    expect(mocks.updateProjectTaskStatus).toHaveBeenCalledWith(["task-1"], "paused");
    expect(mocks.updateProjectTaskStatus).toHaveBeenCalledWith(["task-2"], "paused");
  });

  it("does not launch automatic optimization after stop is latched", async () => {
    configureDesktopQueue(1, 1, true);
    let resolveRequest: (value: ReverseResult) => void = () => undefined;
    mocks.runReversePrompt.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    render(<App />);

    fireEvent.click((await screen.findAllByRole("button", { name: "开始队列" }))[0]);
    await waitFor(() => expect(mocks.runReversePrompt).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    resolveRequest(result);

    await screen.findByText("队列已停止");
    expect(mocks.runPromptOptimization).not.toHaveBeenCalled();
    expect(mocks.completeProjectTask).not.toHaveBeenCalled();
  });

  it("applies and persists a selected theme immediately", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(await screen.findByRole("radio", { name: /深色/ }));

    await waitFor(() => expect(mocks.saveTheme).toHaveBeenCalledWith("dark"));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    await waitFor(() => expect(document.body).toHaveAttribute("arco-theme", "dark"));
  });

  it("moves history into a drawer at the minimum window width", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("max-width"), media: query, onchange: null,
        addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
      })),
    });
    mocks.loadHistory.mockResolvedValue([{
      id: "history-1", title: "历史缩略图", inputSummary: "sample.png", thumbnail: image.thumbnail,
      imageInfo: image, result, createdAt: "2026-07-24T00:00:00Z",
    }]);
    try {
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "打开历史记录" }));
      expect(await screen.findByText("仅保留缩略图")).toBeInTheDocument();
      expect(document.querySelector(".workspace > .sidebar")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    }
  });

  it("persists a title changed from the history context menu", async () => {
    const historyItem = {
      id: "history-rename", title: "旧标题", inputSummary: "sample.png", thumbnail: image.thumbnail,
      imageInfo: image, result, createdAt: "2026-07-24T00:00:00Z",
    };
    mocks.loadHistory.mockResolvedValue([historyItem]);
    render(<App />);

    const row = await screen.findByLabelText("历史任务：旧标题");
    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });
    fireEvent.click(await screen.findByText("修改标题"));
    fireEvent.change(await screen.findByLabelText("历史任务标题"), { target: { value: "新标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.persistHistory).toHaveBeenCalledWith([
      expect.objectContaining({ id: "history-rename", title: "新标题" }),
    ]));
    expect(await screen.findByText("新标题")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜索历史记录"), { target: { value: "新标题" } });
    expect(await screen.findByLabelText("历史任务：新标题")).toBeInTheDocument();
  });

  it("starts generation with Command Enter", async () => {
    mocks.runReversePrompt.mockResolvedValue(result);
    render(<App />);
    await chooseImage();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => expect(mocks.runReversePrompt).toHaveBeenCalledTimes(1));
  });

  it("在未配置 API Key 时直接引导到设置页", async () => {
    mocks.getSettings.mockResolvedValue({ ...settings, hasApiKey: false });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "配置模型服务" }));
    expect(await screen.findByRole("heading", { name: "系统设置" })).toBeInTheDocument();
  });

  it("关闭自动保存时保留结果并支持手动保存", async () => {
    mocks.getSettings.mockResolvedValue({ ...settings, autoSaveHistory: false });
    mocks.runReversePrompt.mockResolvedValue(result);
    render(<App />);

    await chooseImage();
    fireEvent.click(screen.getByRole("button", { name: "开始反推" }));

    expect(await screen.findByText("中文提示词", { selector: "pre" })).toBeInTheDocument();
    expect(mocks.persistHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存历史" }));
    await waitFor(() => expect(mocks.persistHistory).toHaveBeenCalledTimes(1));
  });

  it("历史写入失败时保留完整结果并允许重试", async () => {
    mocks.runReversePrompt.mockResolvedValue(result);
    mocks.persistHistory.mockRejectedValueOnce(new Error("磁盘暂时不可用"));
    render(<App />);

    await chooseImage();
    fireEvent.click(screen.getByRole("button", { name: "开始反推" }));

    expect(await screen.findByText("结果已生成，但历史记录尚未保存")).toBeInTheDocument();
    expect(screen.getByText("中文提示词", { selector: "pre" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存历史" }));
    await waitFor(() => expect(mocks.persistHistory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("结果已生成，但历史记录尚未保存")).not.toBeInTheDocument());
  });

  it("设置和历史加载失败后可分别重试", async () => {
    const historyItem = {
      id: "history-retry", title: "恢复的历史", inputSummary: "sample.png", thumbnail: image.thumbnail,
      imageInfo: image, result, createdAt: "2026-07-24T00:00:00Z",
    };
    mocks.getSettings.mockRejectedValueOnce(new Error("设置文件暂时不可读")).mockResolvedValue(settings);
    mocks.loadHistory.mockRejectedValueOnce(new Error("历史文件暂时不可读")).mockResolvedValue([historyItem]);
    render(<App />);

    expect(await screen.findByText("设置加载失败")).toBeInTheDocument();
    expect(await screen.findByText("历史记录加载失败")).toBeInTheDocument();
    expect(document.querySelectorAll(".notice-stack .arco-alert")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "重试加载设置" }));
    fireEvent.click(screen.getByRole("button", { name: "重试加载历史" }));

    await waitFor(() => expect(screen.queryByText("设置加载失败")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("历史记录加载失败")).not.toBeInTheDocument());
    expect(await screen.findByLabelText("历史任务：恢复的历史")).toBeInTheDocument();
  });

  it("keeps only the latest image when preprocessing finishes out of order", async () => {
    let resolveFirst: (value: PreparedImage) => void = () => undefined;
    let resolveSecond: (value: PreparedImage) => void = () => undefined;
    mocks.prepareImage
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    render(<App />);
    const input = document.querySelector<HTMLInputElement>('.drop-target input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["first"], "first.png", { type: "image/png" })] } });
    fireEvent.change(input, { target: { files: [new File(["second"], "second.png", { type: "image/png" })] } });

    const second = { ...image, name: "second.png", previewUrl: "data:image/png;base64,second" };
    resolveSecond(second);
    await waitFor(() => expect(screen.getByAltText("待分析图片")).toHaveAttribute("src", second.previewUrl));
    resolveFirst({ ...image, name: "first.png", previewUrl: "data:image/png;base64,first" });
    await Promise.resolve();

    expect(screen.getByAltText("待分析图片")).toHaveAttribute("src", second.previewUrl);
  });
});

async function chooseImage() {
  const input = document.querySelector<HTMLInputElement>('.drop-target input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files: [new File(["image"], "sample.png", { type: "image/png" })] } });
  await screen.findByAltText("待分析图片");
}
