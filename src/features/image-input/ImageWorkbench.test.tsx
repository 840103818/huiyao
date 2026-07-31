import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageWorkbench } from "./ImageWorkbench";
import type { PreparedImage } from "../../shared/contracts";

const bridgeMocks = vi.hoisted(() => ({ setViewerChromeHidden: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../infrastructure/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infrastructure/tauri")>()),
  setViewerChromeHidden: bridgeMocks.setViewerChromeHidden,
}));

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

const tallImage: PreparedImage = {
  ...image,
  name: "sample-tall.png",
  previewUrl: "data:image/png;base64,tall-preview",
  width: 900,
  height: 2400,
};

function renderWorkbench(onZoomChange = vi.fn()) {
  return render(
    <ImageWorkbench
      image={image}
      displayImage={image.previewUrl}
      imageInfo={image}
      requirements=""
      outputLanguage="bilingual"
      detailLevel="standard"
      zoom={100}
      fitMode="contain"
      loading={false}
      onImageFile={vi.fn()}
      onRequirementsChange={vi.fn()}
      onOutputLanguageChange={vi.fn()}
      onDetailLevelChange={vi.fn()}
      onZoomChange={onZoomChange}
      onFitModeChange={vi.fn()}
      onGenerate={vi.fn()}
      generationState="idle"
    />,
  );
}

describe("ImageWorkbench", () => {
  it("opens the body-level image viewer, hides native chrome, and restores it on Escape", async () => {
    vi.useFakeTimers();
    bridgeMocks.setViewerChromeHidden.mockClear();
    const { container } = renderWorkbench();
    fireEvent.doubleClick(screen.getByTitle("双击放大查看"));
    const viewer = screen.getByRole("dialog", { name: "图片查看器" });
    expect(viewer).toBeInTheDocument();
    expect(viewer.parentElement).toBe(document.body);
    expect(container.querySelector(".input-lab .image-viewer")).not.toBeInTheDocument();
    expect(bridgeMocks.setViewerChromeHidden).toHaveBeenCalledWith(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "图片查看器" })).toHaveClass("is-closing");
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole("dialog", { name: "图片查看器" })).not.toBeInTheDocument();
    await Promise.resolve();
    expect(bridgeMocks.setViewerChromeHidden).toHaveBeenLastCalledWith(false);
    vi.useRealTimers();
  });

  it("maps trackpad pinch input to pointer-centered zoom without hijacking ordinary scrolling", () => {
    const onZoomChange = vi.fn();
    renderWorkbench(onZoomChange);

    fireEvent.wheel(screen.getByTitle("双击放大查看"), { deltaY: -100 });
    expect(onZoomChange).not.toHaveBeenCalled();
    fireEvent.wheel(screen.getByTitle("双击放大查看"), { deltaY: -100, ctrlKey: true, clientX: 200, clientY: 160 });
    expect(onZoomChange).toHaveBeenCalledWith(122);
  });

  it("keeps the floating toolbar interactive while the image is zoomed", () => {
    const onZoomChange = vi.fn();
    const onFitModeChange = vi.fn();
    const { container } = render(
      <ImageWorkbench
        image={image} displayImage={image.previewUrl} imageInfo={image} requirements=""
        outputLanguage="chinese" detailLevel="expert" zoom={150} fitMode="contain"
        loading={false} generationState="idle" onImageFile={vi.fn()}
        onRequirementsChange={vi.fn()} onOutputLanguageChange={vi.fn()} onDetailLevelChange={vi.fn()}
        onZoomChange={onZoomChange} onFitModeChange={onFitModeChange} onGenerate={vi.fn()}
      />,
    );
    const stage = container.querySelector<HTMLElement>(".image-stage")!;
    stage.setPointerCapture = vi.fn();

    const zoomIn = screen.getByRole("button", { name: "放大" });
    fireEvent.pointerDown(zoomIn, { button: 0, pointerId: 1 });
    fireEvent.click(zoomIn);
    expect(stage.setPointerCapture).not.toHaveBeenCalled();
    expect(onZoomChange).toHaveBeenCalledWith(160);

    fireEvent.click(screen.getByRole("button", { name: "重置视图" }));
    expect(onZoomChange).toHaveBeenCalledWith(100);
    fireEvent.click(screen.getByRole("button", { name: "填满画布" }));
    expect(onFitModeChange).toHaveBeenCalledWith("cover");
  });

  it("allows a zoomed tall image to be dragged vertically on the main canvas", () => {
    const { container } = render(
      <ImageWorkbench
        image={tallImage} displayImage={tallImage.previewUrl} imageInfo={tallImage} requirements=""
        outputLanguage="chinese" detailLevel="expert" zoom={200} fitMode="contain"
        loading={false} generationState="idle" onImageFile={vi.fn()}
        onRequirementsChange={vi.fn()} onOutputLanguageChange={vi.fn()} onDetailLevelChange={vi.fn()}
        onZoomChange={vi.fn()} onFitModeChange={vi.fn()} onGenerate={vi.fn()}
      />,
    );
    const stage = container.querySelector<HTMLElement>(".image-stage")!;
    Object.defineProperties(stage, { clientWidth: { configurable: true, value: 600 }, clientHeight: { configurable: true, value: 300 } });
    stage.setPointerCapture = vi.fn();
    stage.hasPointerCapture = vi.fn(() => true);
    stage.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(stage, { button: 0, pointerId: 2, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 300, clientY: 270 });
    expect(screen.getByAltText("待分析图片")).toHaveStyle({ transform: "translate3d(0px, 120px, 0) scale(2)" });
  });

  it("uses ordinary trackpad scrolling to pan a zoomed tall image in the viewer", async () => {
    render(
      <ImageWorkbench
        image={tallImage} displayImage={tallImage.previewUrl} imageInfo={tallImage} requirements=""
        outputLanguage="chinese" detailLevel="expert" zoom={100} fitMode="contain"
        loading={false} generationState="idle" onImageFile={vi.fn()}
        onRequirementsChange={vi.fn()} onOutputLanguageChange={vi.fn()} onDetailLevelChange={vi.fn()}
        onZoomChange={vi.fn()} onFitModeChange={vi.fn()} onGenerate={vi.fn()}
      />,
    );
    fireEvent.doubleClick(screen.getByTitle("双击放大查看"));
    const viewer = screen.getByRole("dialog", { name: "图片查看器" });
    const canvas = viewer.querySelector<HTMLElement>(".viewer-canvas")!;
    Object.defineProperties(canvas, { clientWidth: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 600 } });
    fireEvent.click(viewer.querySelector<HTMLButtonElement>('[aria-label="实际大小 100%"]')!);

    fireEvent.wheel(canvas, { deltaX: 0, deltaY: 120 });
    await act(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    expect(viewer.querySelector(".viewer-image-frame")).toHaveStyle({ transform: "translate3d(0px, -120px, 0) scale(1)" });
  });

  it("changes language and detail from full-width segmented controls", () => {
    const onLanguageChange = vi.fn();
    const onDetailChange = vi.fn();
    render(
      <ImageWorkbench
        image={image}
        displayImage={image.previewUrl}
        imageInfo={image}
        requirements=""
        outputLanguage="bilingual"
        detailLevel="standard"
        zoom={100}
        fitMode="contain"
        loading={false}
        generationState="idle"
        onImageFile={vi.fn()}
        onRequirementsChange={vi.fn()}
        onOutputLanguageChange={onLanguageChange}
        onDetailLevelChange={onDetailChange}
        onZoomChange={vi.fn()}
        onFitModeChange={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "反推参数" }));
    expect(screen.queryByRole("toolbar", { name: "图片画布工具" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "中文" }));
    expect(onLanguageChange).toHaveBeenCalledWith("chinese");

    fireEvent.click(screen.getByRole("radio", { name: "专家级" }));
    expect(onDetailChange).toHaveBeenCalledWith("expert");
  });

  it("renders the expanded requirements field and localized input status", () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole("button", { name: "反推参数" }));
    expect(screen.getByLabelText("补充要求 可选")).toBeInTheDocument();
    expect(screen.getByText("图像就绪")).toBeInTheDocument();
  });

  it("accepts a dropped image across the populated canvas", () => {
    const onImageFile = vi.fn();
    render(
      <ImageWorkbench
        image={image} displayImage={image.previewUrl} imageInfo={image} requirements=""
        outputLanguage="chinese" detailLevel="expert" zoom={100} fitMode="contain"
        loading={false} generationState="idle" onImageFile={onImageFile}
        onRequirementsChange={vi.fn()} onOutputLanguageChange={vi.fn()} onDetailLevelChange={vi.fn()}
        onZoomChange={vi.fn()} onFitModeChange={vi.fn()} onGenerate={vi.fn()}
      />,
    );
    const stage = screen.getByTitle("双击放大查看");
    const file = new File(["image"], "replacement.png", { type: "image/png" });
    const dataTransfer = { types: ["Files"], files: { item: () => file, length: 1, 0: file }, dropEffect: "none" };
    fireEvent.dragEnter(stage, { dataTransfer });
    expect(screen.getByText("松开以替换图片")).toBeInTheDocument();
    fireEvent.drop(stage, { dataTransfer });
    expect(onImageFile).toHaveBeenCalledWith(file);
  });

  it("does not replace the image while generation is running", () => {
    const onImageFile = vi.fn();
    const { container } = render(
      <ImageWorkbench
        image={image} displayImage={image.previewUrl} imageInfo={image} requirements=""
        outputLanguage="chinese" detailLevel="expert" zoom={100} fitMode="contain"
        loading generationState="streaming" onImageFile={onImageFile}
        onRequirementsChange={vi.fn()} onOutputLanguageChange={vi.fn()} onDetailLevelChange={vi.fn()}
        onZoomChange={vi.fn()} onFitModeChange={vi.fn()} onGenerate={vi.fn()}
      />,
    );
    const stage = container.querySelector<HTMLElement>(".image-stage")!;
    const file = new File(["image"], "replacement.png", { type: "image/png" });
    const dataTransfer = { types: ["Files"], files: { item: () => file, length: 1, 0: file }, dropEffect: "copy" };
    fireEvent.dragEnter(stage, { dataTransfer });
    expect(screen.getByText("当前无法替换图片")).toBeInTheDocument();
    expect(screen.getByText("分析进行中", { selector: ".analysis-action-status" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument();
    expect(stage).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("toolbar", { name: "图片画布工具" })).toHaveAttribute("inert");
    fireEvent.drop(stage, { dataTransfer });
    expect(onImageFile).not.toHaveBeenCalled();
  });
});
