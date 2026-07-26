import type { GenerationState } from "../../shared/contracts";

interface ProcessingStatusProps {
  kind: "generation" | "optimization";
  state: GenerationState;
  elapsedMs: number;
  requestStarted?: boolean;
  receivedCharacters?: number;
  completedItems?: number;
  totalItems?: number;
  firstTokenMs?: number;
  languageReady?: { zh: boolean; en: boolean; negative?: boolean };
}

const stageLabels = {
  generation: ["准备图片", "连接模型", "等待首字", "实时解析", "整理结果"],
  optimization: ["准备优化", "连接模型", "等待首字", "生成双语", "整理结果"],
} as const;

export function ProcessingStatus({
  kind,
  state,
  elapsedMs,
  requestStarted = false,
  receivedCharacters = 0,
  completedItems,
  totalItems,
  firstTokenMs,
  languageReady,
}: ProcessingStatusProps) {
  const labels = stageLabels[kind];
  const activeIndex = getActiveIndex(state, requestStarted, receivedCharacters);
  const statusText = getStatusText(state, activeIndex, labels);
  const waitingText = getWaitingText(state, activeIndex, elapsedMs);

  return (
    <div className="processing-status" data-state={state} role="status" aria-live="polite">
      <div className="processing-status-head">
        <span className="processing-current"><i aria-hidden="true" />{statusText}</span>
        <time>{formatElapsed(elapsedMs)}</time>
      </div>
      <ol className="processing-stages" aria-label={kind === "generation" ? "生成进度阶段" : "优化进度阶段"}>
        {labels.map((label, index) => (
          <li
            key={label}
            className={index < activeIndex || state === "complete" ? "is-done" : index === activeIndex ? "is-active" : ""}
            aria-current={index === activeIndex && state !== "complete" ? "step" : undefined}
          >
            <i aria-hidden="true" />
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <div className="processing-facts">
        {firstTokenMs !== undefined ? <span>首字 {firstTokenMs} 毫秒</span> : null}
        {receivedCharacters > 0 ? <span>已接收 {receivedCharacters.toLocaleString("zh-CN")} 字符</span> : null}
        {completedItems !== undefined && totalItems !== undefined ? <span>测定 {completedItems}/{totalItems} 项</span> : null}
        {languageReady ? (
          <span className="processing-languages">
            <i className={languageReady.zh ? "is-ready" : ""} />中文
            <i className={languageReady.en ? "is-ready" : ""} />英文
            {languageReady.negative !== undefined ? <><i className={languageReady.negative ? "is-ready" : ""} />负面</> : null}
          </span>
        ) : null}
        {waitingText ? <strong>{waitingText}</strong> : null}
      </div>
    </div>
  );
}

function getActiveIndex(state: GenerationState, requestStarted: boolean, receivedCharacters: number): number {
  if (state === "complete") return 4;
  if (state === "streaming" || state === "fallback" || receivedCharacters > 0) return 3;
  if (state === "connecting" && requestStarted) return 2;
  if (state === "connecting") return 1;
  if (state === "stopping") return receivedCharacters > 0 ? 3 : requestStarted ? 2 : 1;
  return 0;
}

function getStatusText(state: GenerationState, activeIndex: number, labels: readonly string[]): string {
  if (state === "fallback") return "兼容模式处理中";
  if (state === "stopping") return "正在停止";
  if (state === "cancelled") return "已停止";
  if (state === "complete") return "处理完成";
  return labels[activeIndex];
}

function getWaitingText(state: GenerationState, activeIndex: number, elapsedMs: number): string | undefined {
  if (state !== "connecting" || activeIndex !== 2) return undefined;
  if (elapsedMs >= 20_000) return "响应时间较长，可继续等待或停止";
  if (elapsedMs >= 8_000) return "模型仍在处理，请稍候";
  return undefined;
}

function formatElapsed(elapsedMs: number): string {
  return `${(Math.max(0, elapsedMs) / 1000).toFixed(elapsedMs >= 100_000 ? 0 : 1)} 秒`;
}
