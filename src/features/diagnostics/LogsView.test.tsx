import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeLogEntry } from "../../shared/contracts";
import { LogsView } from "./LogsView";

const entries: RuntimeLogEntry[] = [
  {
    id: "log-2",
    timestamp: "2026-07-24T02:00:01.123Z",
    level: "error",
    category: "model",
    event: "request_failed",
    message: "大模型反推请求失败",
    details: { interactionId: "req-123", errorCode: "http_429", elapsedMs: 812 },
  },
  {
    id: "log-1",
    timestamp: "2026-07-24T02:00:00.000Z",
    level: "info",
    category: "system",
    event: "app_started",
    message: "应用已启动",
    details: { version: "0.2.0" },
  },
];

const loadRuntimeLogs = vi.fn();

vi.mock("../../infrastructure/tauri", () => ({
  loadRuntimeLogs: () => loadRuntimeLogs(),
  clearRuntimeLogs: vi.fn(),
  exportRuntimeLogs: vi.fn(),
  getErrorMessage: (error: unknown) => String(error),
}));

describe("LogsView", () => {
  beforeEach(() => loadRuntimeLogs.mockResolvedValue(entries));

  it("renders model diagnostics and searchable structured details", async () => {
    render(<LogsView />);
    expect(await screen.findByText("request_failed")).toBeInTheDocument();
    expect(screen.getByText("大模型反推请求失败")).toBeInTheDocument();

    fireEvent.click(screen.getByText("request_failed"));
    expect(screen.getByText("http_429")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜索运行日志"), { target: { value: "req-123" } });
    await waitFor(() => expect(screen.queryByText("app_started")).not.toBeInTheDocument());
    expect(screen.getByText("request_failed")).toBeInTheDocument();
  });

  it("keeps filters and log actions in separate stable toolbar groups", async () => {
    const { container } = render(<LogsView />);
    await screen.findByText("request_failed");
    expect(container.querySelector(".log-filter-group")).toContainElement(screen.getByLabelText("搜索运行日志"));
    expect(container.querySelector(".log-action-group")).toContainElement(screen.getByRole("button", { name: "刷新" }));
  });
});
