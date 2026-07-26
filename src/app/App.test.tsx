import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { PreparedImage, PublicSettings, ReverseResult } from "../shared/contracts";

const mocks = vi.hoisted(() => ({
  applyNativeTheme: vi.fn().mockResolvedValue(undefined),
  cancelReversePrompt: vi.fn().mockResolvedValue(true),
  getSettings: vi.fn(),
  loadHistory: vi.fn().mockResolvedValue([]),
  persistHistory: vi.fn().mockResolvedValue(undefined),
  runReversePrompt: vi.fn(),
  saveTheme: vi.fn(),
  saveWorkspacePreferences: vi.fn(),
  prepareImage: vi.fn(),
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
    saveTheme: mocks.saveTheme,
    saveWorkspacePreferences: mocks.saveWorkspacePreferences,
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

describe("App image reverse workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue(settings);
    mocks.loadHistory.mockResolvedValue([]);
    mocks.prepareImage.mockResolvedValue(image);
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
    expect(await screen.findByText("部分结果")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    await waitFor(() => expect(mocks.cancelReversePrompt).toHaveBeenCalledWith("req-cancel"));
    rejectRequest({ code: "cancelled", message: "已停止生成" });

    await screen.findByText("生成已停止");
    expect(mocks.persistHistory).not.toHaveBeenCalled();
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
