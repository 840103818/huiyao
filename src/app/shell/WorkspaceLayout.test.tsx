import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceLayout } from "./WorkspaceLayout";

function renderLayout(overrides: Partial<React.ComponentProps<typeof WorkspaceLayout>> = {}) {
  const props: React.ComponentProps<typeof WorkspaceLayout> = {
    sidebar: <aside>项目任务</aside>,
    sidebarVisible: true,
    input: <section>视觉输入</section>,
    result: <section>结果检查器</section>,
    onSidebarWidthChange: vi.fn(),
    onInputSplitChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<WorkspaceLayout {...props} />), props };
}

describe("WorkspaceLayout", () => {
  it("applies persisted pane sizes within the supported range", () => {
    const { container } = renderLayout({ sidebarWidth: 320, inputSplitPercent: 60 });
    const workspace = container.querySelector<HTMLElement>(".workspace");
    expect(workspace?.style.getPropertyValue("--project-sidebar-width")).toBe("320px");
    expect(workspace?.style.getPropertyValue("--input-pane-weight")).toBe("60fr");
  });

  it("clamps keyboard resizing and persists the value", () => {
    const onSidebarWidthChange = vi.fn();
    const onInputSplitChange = vi.fn();
    renderLayout({ sidebarWidth: 334, inputSplitPercent: 63.5, onSidebarWidthChange, onInputSplitChange });

    fireEvent.keyDown(screen.getByRole("separator", { name: "调整项目任务栏宽度" }), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("separator", { name: "调整视觉输入和结果区域宽度" }), { key: "ArrowRight" });

    expect(onSidebarWidthChange).toHaveBeenLastCalledWith(336);
    expect(onInputSplitChange).toHaveBeenLastCalledWith(64);
  });

  it("restores the default layout with Home or a double click", () => {
    const onSidebarWidthChange = vi.fn();
    const onInputSplitChange = vi.fn();
    renderLayout({ sidebarWidth: 320, inputSplitPercent: 60, onSidebarWidthChange, onInputSplitChange });

    fireEvent.keyDown(screen.getByRole("separator", { name: "调整项目任务栏宽度" }), { key: "Home" });
    fireEvent.doubleClick(screen.getByRole("separator", { name: "调整视觉输入和结果区域宽度" }));

    expect(onSidebarWidthChange).toHaveBeenLastCalledWith(undefined);
    expect(onInputSplitChange).toHaveBeenLastCalledWith(undefined);
  });

  it("persists the final pointer drag values", () => {
    const onSidebarWidthChange = vi.fn();
    const onInputSplitChange = vi.fn();
    const { container } = renderLayout({ onSidebarWidthChange, onInputSplitChange });
    const workbench = container.querySelector<HTMLElement>(".workbench-grid");
    Object.defineProperty(workbench, "clientWidth", { configurable: true, value: 1008 });

    const sidebarSeparator = screen.getByRole("separator", { name: "调整项目任务栏宽度" });
    fireEvent.pointerDown(sidebarSeparator, { button: 0, pointerId: 1, clientX: 272 });
    fireEvent.pointerMove(sidebarSeparator, { pointerId: 1, clientX: 312 });
    fireEvent.pointerUp(sidebarSeparator, { pointerId: 1, clientX: 312 });

    const contentSeparator = screen.getByRole("separator", { name: "调整视觉输入和结果区域宽度" });
    fireEvent.pointerDown(contentSeparator, { button: 0, pointerId: 2, clientX: 520 });
    fireEvent.pointerMove(contentSeparator, { pointerId: 2, clientX: 570 });
    fireEvent.pointerUp(contentSeparator, { pointerId: 2, clientX: 570 });

    expect(onSidebarWidthChange).toHaveBeenLastCalledWith(312);
    expect(onInputSplitChange).toHaveBeenLastCalledWith(57);
  });

  it("uses a single content column for the project overview", () => {
    renderLayout({ overview: <section>项目概览</section> });
    expect(screen.getByText("项目概览")).toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "调整视觉输入和结果区域宽度" })).not.toBeInTheDocument();
  });
});
