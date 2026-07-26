import { Channel, invoke } from "@tauri-apps/api/core";
import type { PromptOptimizationOutput, PromptOptimizationRequest, ReverseRequest, ReverseResult, ReverseStreamEvent } from "../../shared/contracts";
import { desktopOnlyError, isDesktopApp } from "./core";

export async function runReversePrompt(request: ReverseRequest, onEvent: (event: ReverseStreamEvent) => void): Promise<ReverseResult> {
  if (!isDesktopApp()) throw desktopOnlyError();
  const channel = new Channel<ReverseStreamEvent>();
  channel.onmessage = onEvent;
  return invoke<ReverseResult>("reverse_prompt_stream", { request, onEvent: channel });
}

export async function runPromptOptimization(request: PromptOptimizationRequest, onEvent: (event: ReverseStreamEvent) => void): Promise<PromptOptimizationOutput> {
  if (!isDesktopApp()) throw desktopOnlyError();
  const channel = new Channel<ReverseStreamEvent>();
  channel.onmessage = onEvent;
  return invoke<PromptOptimizationOutput>("optimize_prompt_stream", { request, onEvent: channel });
}

export async function cancelReversePrompt(interactionId: string): Promise<boolean> {
  return isDesktopApp() ? invoke<boolean>("cancel_reverse_prompt", { interactionId }) : false;
}
