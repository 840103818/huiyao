import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BatchProgress } from "../../shared/contracts";
import { ProjectOverview } from "./ProjectOverview";

const progress: BatchProgress = {
  total: 0,
  ready: 0,
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  paused: 0,
};

describe("ProjectOverview", () => {
  it("imports files dropped anywhere on the overview", () => {
    const onImportFiles = vi.fn();
    const { container } = render(
      <ProjectOverview tasks={[]} progress={progress} onImport={vi.fn()} onImportFiles={onImportFiles} onStart={vi.fn()} onSelect={vi.fn()} />,
    );
    const overview = container.querySelector<HTMLElement>(".project-overview");
    const file = new File(["preview"], "preview.png", { type: "image/png" });

    fireEvent.dragEnter(overview!, { dataTransfer: { files: [file] } });
    expect(screen.getByText("松开以导入到当前项目")).toBeInTheDocument();
    fireEvent.drop(overview!, { dataTransfer: { files: [file] } });

    expect(onImportFiles).toHaveBeenCalledWith([file]);
    expect(screen.queryByText("松开以导入到当前项目")).not.toBeInTheDocument();
  });

  it("uses the empty-state import action", () => {
    const onImport = vi.fn();
    render(<ProjectOverview tasks={[]} progress={progress} onImport={onImport} onImportFiles={vi.fn()} onStart={vi.fn()} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "导入第一张图片" }));
    expect(onImport).toHaveBeenCalledOnce();
  });
});
