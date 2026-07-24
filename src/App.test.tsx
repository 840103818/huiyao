import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { PreparedImage, PublicSettings, ReverseResult } from "./types";

const mocks = vi.hoisted(() => ({
  applyNativeTheme: vi.fn().mockResolvedValue(undefined),
  cancelReversePrompt: vi.fn().mockResolvedValue(true),
  getSettings: vi.fn(),
  loadHistory: vi.fn().mockResolvedValue([]),
  persistHistory: vi.fn().mockResolvedValue(undefined),
  runReversePrompt: vi.fn(),
  saveTheme: vi.fn(),
  prepareImage: vi.fn(),
}));

vi.mock("./lib/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/bridge")>();
  return {
    ...actual,
    applyNativeTheme: mocks.applyNativeTheme,
    cancelReversePrompt: mocks.cancelReversePrompt,
    getSettings: mocks.getSettings,
    loadHistory: mocks.loadHistory,
    persistHistory: mocks.persistHistory,
    runReversePrompt: mocks.runReversePrompt,
    saveTheme: mocks.saveTheme,
  };
});

vi.mock("./lib/image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/image")>();
  return { ...actual, prepareImage: mocks.prepareImage };
});

const settings: PublicSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "vision-model",
  timeoutSeconds: 120,
  theme: "light",
  hasApiKey: true,
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
    composition: "居中构图",
    lighting: "轮廓光",
    colors: "黑色与荧光绿",
    palette: ["#111315", "#b9ef2c"],
    materials: "钛金属",
    style: "精密仪器",
    camera: "微距视角",
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
      fireEvent.click(await screen.findByRole("button", { name: "历史记录" }));
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
});

async function chooseImage() {
  const input = document.querySelector<HTMLInputElement>('.drop-target input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files: [new File(["image"], "sample.png", { type: "image/png" })] } });
  await screen.findByAltText("待分析图片");
}
