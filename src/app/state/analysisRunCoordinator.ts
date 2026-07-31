export type CancelInteraction = (interactionId: string) => Promise<unknown>;

export class AnalysisRunCoordinator {
  private active = false;
  private stopRequested = false;
  private workerCount = 0;
  private readonly interactionIds = new Set<string>();
  private readonly settledWaiters = new Set<() => void>();

  constructor(private readonly cancelInteraction: CancelInteraction) {}

  begin(): void {
    if (this.active) throw new Error("analysis run already active");
    this.active = true;
    this.stopRequested = false;
    this.workerCount = 0;
    this.interactionIds.clear();
  }

  beginWorker(): void {
    if (!this.active) throw new Error("analysis run is not active");
    this.workerCount += 1;
  }

  endWorker(): void {
    if (this.workerCount > 0) this.workerCount -= 1;
    this.resolveSettledIfReady();
  }

  registerInteraction(interactionId: string): boolean {
    if (!this.active) return false;
    const alreadyRegistered = this.interactionIds.has(interactionId);
    this.interactionIds.add(interactionId);
    if (this.stopRequested && !alreadyRegistered) {
      void this.cancelInteraction(interactionId).catch(() => undefined);
      return false;
    }
    return !this.stopRequested;
  }

  unregisterInteraction(interactionId?: string): void {
    if (interactionId) this.interactionIds.delete(interactionId);
  }

  requestStop(): boolean {
    if (!this.active || this.stopRequested) return false;
    this.stopRequested = true;
    for (const interactionId of this.interactionIds) {
      void this.cancelInteraction(interactionId).catch(() => undefined);
    }
    this.resolveSettledIfReady();
    return true;
  }

  shouldStop(): boolean {
    return this.stopRequested;
  }

  isActive(): boolean {
    return this.active;
  }

  waitForSettled(): Promise<void> {
    if (this.workerCount === 0) return Promise.resolve();
    return new Promise((resolve) => this.settledWaiters.add(resolve));
  }

  finish(): void {
    if (this.workerCount !== 0) throw new Error("analysis workers are still active");
    this.active = false;
    this.stopRequested = false;
    this.interactionIds.clear();
    this.resolveSettledIfReady();
  }

  private resolveSettledIfReady(): void {
    if (this.workerCount !== 0) return;
    for (const resolve of this.settledWaiters) resolve();
    this.settledWaiters.clear();
  }
}
