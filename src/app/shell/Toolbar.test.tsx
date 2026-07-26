import { render, screen } from "@testing-library/react";
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
});
