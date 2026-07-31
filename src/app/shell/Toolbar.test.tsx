import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import packageMetadata from "../../../package.json";
import { Toolbar } from "./Toolbar";

describe("Toolbar", () => {
  it("keeps history navigation before the brand in compact mode and reads the package version", () => {
    const { container } = render(
      <Toolbar sidebarCollapsed={false} compactHistory view="workspace" generationState="idle" elapsedMs={0} onToggleSidebar={vi.fn()} onNavigate={vi.fn()} />,
    );
    const leading = container.querySelector(".toolbar-leading")!;
    const button = screen.getByRole("button", { name: "打开历史记录" });
    const wordmark = leading.querySelector(".wordmark")!;
    expect(button.compareDocumentPosition(wordmark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(wordmark).toHaveTextContent(`v${packageMetadata.version}`);
  });

  it("uses the same leading slot for returning from secondary views", () => {
    render(<Toolbar sidebarCollapsed compactHistory={false} view="settings" generationState="idle" elapsedMs={0} onToggleSidebar={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "返回工作台" })).toBeInTheDocument();
    expect(screen.getByText("系统设置")).toBeInTheDocument();
  });

  it("hides redundant idle status and shows only an active real state", () => {
    const { rerender } = render(
      <Toolbar sidebarCollapsed={false} compactHistory={false} view="workspace" generationState="idle" elapsedMs={0} projectTitle="产品摄影" taskTitle="项目概览" onToggleSidebar={vi.fn()} onNavigate={vi.fn()} />,
    );
    expect(screen.queryByText("图片反推")).not.toBeInTheDocument();

    rerender(
      <Toolbar sidebarCollapsed={false} compactHistory={false} view="workspace" generationState="streaming" elapsedMs={1_240} projectTitle="产品摄影" taskTitle="金属香氛瓶" onToggleSidebar={vi.fn()} onNavigate={vi.fn()} />,
    );
    expect(screen.getByText("流式解析")).toBeInTheDocument();
    expect(screen.getByText("1.2 秒")).toBeInTheDocument();
  });

  it("keeps a global stop action available while navigation is locked", () => {
    const onStop = vi.fn();
    render(<Toolbar sidebarCollapsed compactHistory view="workspace" generationState="streaming" elapsedMs={1_240} disabled onStop={onStop} onToggleSidebar={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.getByRole("button", { name: "打开历史记录" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "运行日志" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "设置" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
