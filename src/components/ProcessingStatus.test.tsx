import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProcessingStatus } from "./ProcessingStatus";

describe("ProcessingStatus", () => {
  it("shows real waiting thresholds without a fake percentage", () => {
    const { rerender } = render(<ProcessingStatus kind="generation" state="connecting" requestStarted elapsedMs={8_100} />);
    expect(screen.getAllByText("等待首字")).toHaveLength(2);
    expect(screen.getByText("模型仍在处理，请稍候")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();

    rerender(<ProcessingStatus kind="generation" state="connecting" requestStarted elapsedMs={20_100} />);
    expect(screen.getByText("响应时间较长，可继续等待或停止")).toBeInTheDocument();
  });

  it("reports only received characters and completed analysis items", () => {
    render(<ProcessingStatus kind="generation" state="streaming" elapsedMs={2_400} receivedCharacters={321} completedItems={4} totalItems={10} firstTokenMs={680} />);
    expect(screen.getAllByText("实时解析")).toHaveLength(2);
    expect(screen.getByText("已接收 321 字符")).toBeInTheDocument();
    expect(screen.getByText("测定 4/10 项")).toBeInTheDocument();
    expect(screen.getByText("首字 680 毫秒")).toBeInTheDocument();
  });
});
