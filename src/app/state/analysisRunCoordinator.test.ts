import { describe, expect, it, vi } from "vitest";
import { AnalysisRunCoordinator } from "./analysisRunCoordinator";

describe("AnalysisRunCoordinator", () => {
  it("latches one stop request and cancels each active interaction once", async () => {
    const cancel = vi.fn().mockResolvedValue(true);
    const coordinator = new AnalysisRunCoordinator(cancel);
    coordinator.begin();
    coordinator.beginWorker();
    expect(coordinator.registerInteraction("request-1")).toBe(true);

    expect(coordinator.requestStop()).toBe(true);
    expect(coordinator.requestStop()).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("request-1");

    coordinator.endWorker();
    await coordinator.waitForSettled();
    coordinator.finish();
  });

  it("immediately cancels an interaction that starts after stop was requested", () => {
    const cancel = vi.fn().mockResolvedValue(true);
    const coordinator = new AnalysisRunCoordinator(cancel);
    coordinator.begin();
    coordinator.beginWorker();
    coordinator.requestStop();

    expect(coordinator.registerInteraction("late-request")).toBe(false);
    expect(coordinator.registerInteraction("late-request")).toBe(false);
    expect(cancel).toHaveBeenCalledWith("late-request");
    expect(cancel).toHaveBeenCalledTimes(1);
    coordinator.endWorker();
    coordinator.finish();
  });

  it("does not settle until all concurrent workers exit", async () => {
    const coordinator = new AnalysisRunCoordinator(vi.fn().mockResolvedValue(true));
    coordinator.begin();
    coordinator.beginWorker();
    coordinator.beginWorker();
    coordinator.requestStop();
    const settled = vi.fn();
    void coordinator.waitForSettled().then(settled);

    coordinator.endWorker();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    coordinator.endWorker();
    await coordinator.waitForSettled();
    expect(settled).toHaveBeenCalledTimes(1);
    coordinator.finish();
  });
});
