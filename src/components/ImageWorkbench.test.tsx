import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageWorkbench } from "./ImageWorkbench";
import type { PreparedImage } from "../types";

const bridgeMocks = vi.hoisted(() => ({ setViewerChromeHidden: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/bridge")>()),
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

function renderWorkbench(onZoomChange = vi.fn()) {
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
      onImageFile={vi.fn()}
      onRequirementsChange={vi.fn()}
      onOutputLanguageChange={vi.fn()}
      onDetailLevelChange={vi.fn()}
      onZoomChange={onZoomChange}
      onFitModeChange={vi.fn()}
      onGenerate={vi.fn()}
      onStop={vi.fn()}
      generationState="idle"
    />,
  );
}

describe("ImageWorkbench", () => {
  it("opens the image viewer, hides native chrome, and restores it on Escape", async () => {
    bridgeMocks.setViewerChromeHidden.mockClear();
    renderWorkbench();
    fireEvent.doubleClick(screen.getByTitle("双击放大查看"));
    expect(screen.getByRole("dialog", { name: "图片查看器" })).toBeInTheDocument();
    expect(bridgeMocks.setViewerChromeHidden).toHaveBeenCalledWith(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "图片查看器" })).not.toBeInTheDocument();
    await Promise.resolve();
    expect(bridgeMocks.setViewerChromeHidden).toHaveBeenLastCalledWith(false);
  });

  it("maps trackpad pinch input to pointer-centered zoom without hijacking ordinary scrolling", () => {
    const onZoomChange = vi.fn();
    renderWorkbench(onZoomChange);

    fireEvent.wheel(screen.getByTitle("双击放大查看"), { deltaY: -100 });
    expect(onZoomChange).not.toHaveBeenCalled();
    fireEvent.wheel(screen.getByTitle("双击放大查看"), { deltaY: -100, ctrlKey: true, clientX: 200, clientY: 160 });
    expect(onZoomChange).toHaveBeenCalledWith(122);
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
        onStop={vi.fn()}
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
        onZoomChange={vi.fn()} onFitModeChange={vi.fn()} onGenerate={vi.fn()} onStop={vi.fn()}
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
        onZoomChange={vi.fn()} onFitModeChange={vi.fn()} onGenerate={vi.fn()} onStop={vi.fn()}
      />,
    );
    const stage = container.querySelector<HTMLElement>(".image-stage")!;
    const file = new File(["image"], "replacement.png", { type: "image/png" });
    const dataTransfer = { types: ["Files"], files: { item: () => file, length: 1, 0: file }, dropEffect: "copy" };
    fireEvent.dragEnter(stage, { dataTransfer });
    expect(screen.getByText("当前无法替换图片")).toBeInTheDocument();
    fireEvent.drop(stage, { dataTransfer });
    expect(onImageFile).not.toHaveBeenCalled();
  });
});
