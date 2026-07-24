import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageWorkbench } from "./ImageWorkbench";
import type { PreparedImage } from "../types";

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
  it("opens the image viewer on double click and closes with Escape", () => {
    renderWorkbench();
    fireEvent.doubleClick(screen.getByTitle("双击放大查看"));
    expect(screen.getByRole("dialog", { name: "图片查看器" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "图片查看器" })).not.toBeInTheDocument();
  });

  it("maps trackpad wheel input to real zoom state", () => {
    const onZoomChange = vi.fn();
    renderWorkbench(onZoomChange);

    fireEvent.wheel(screen.getByTitle("双击放大查看"), { deltaY: -100 });
    expect(onZoomChange).toHaveBeenCalledWith(112);
  });

  it("opens language and detail choices from the complete select trigger", async () => {
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

    fireEvent.click(screen.getByRole("combobox", { name: "输出语言" }));
    fireEvent.click(await screen.findByText("仅中文"));
    expect(onLanguageChange).toHaveBeenCalledWith("chinese", expect.anything());

    fireEvent.click(screen.getByRole("combobox", { name: "详细程度" }));
    fireEvent.click(await screen.findByText("专家级"));
    expect(onDetailChange).toHaveBeenCalledWith("expert", expect.anything());
  });

  it("renders the expanded requirements field and localized input status", () => {
    renderWorkbench();
    expect(screen.getByLabelText("补充要求 可选")).toBeInTheDocument();
    expect(screen.getByText("图像就绪")).toBeInTheDocument();
  });
});
