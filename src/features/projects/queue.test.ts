import { describe, expect, it } from "vitest";
import { runTaskQueue } from "./queue";

describe("runTaskQueue", () => {
  it("limits processing to two concurrent tasks", async () => {
    let active = 0;
    let peak = 0;
    await runTaskQueue([1, 2, 3, 4], 2, () => true, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });
    expect(peak).toBe(2);
  });

  it("continues after an individual task fails", async () => {
    const completed: number[] = [];
    const failed: number[] = [];
    await runTaskQueue([1, 2, 3], 1, () => true, async (item) => {
      if (item === 2) throw new Error("failed");
      completed.push(item);
    }, (item) => failed.push(item));
    expect(completed).toEqual([1, 3]);
    expect(failed).toEqual([2]);
  });

  it("does not start new tasks after stopping", async () => {
    let running = true;
    const started: number[] = [];
    const count = await runTaskQueue([1, 2, 3], 1, () => running, async (item) => {
      started.push(item);
      running = false;
    });
    expect(count).toBe(1);
    expect(started).toEqual([1]);
  });

  it("lets two active workers settle without starting a third task after stop", async () => {
    let running = true;
    const started: number[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queue = runTaskQueue([1, 2, 3, 4], 2, () => running, async (item) => {
      started.push(item);
      if (started.length === 2) running = false;
      await gate;
    });

    await Promise.resolve();
    expect(started.sort()).toEqual([1, 2]);
    release?.();
    expect(await queue).toBe(2);
    expect(started.sort()).toEqual([1, 2]);
  });
});
