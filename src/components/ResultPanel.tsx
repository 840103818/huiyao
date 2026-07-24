import { Badge, Empty, Skeleton, Tag } from "@arco-design/web-react";
import { IconApps, IconBulb, IconCamera, IconEye, IconPalette, IconScan, IconStorage } from "@arco-design/web-react/icon";
import type { GenerationState, ReverseResult } from "../types";

interface ResultPanelProps {
  result: ReverseResult | null;
  generationState: GenerationState;
}

const rows = [
  ["subject", "主体", IconScan],
  ["composition", "构图", IconApps],
  ["lighting", "光线", IconBulb],
  ["colors", "色彩", IconPalette],
  ["materials", "材质", IconStorage],
  ["style", "风格", IconEye],
  ["camera", "镜头", IconCamera],
] as const;

export function ResultPanel({ result, generationState }: ResultPanelProps) {
  const analysis = result?.analysis;
  const loading = ["connecting", "streaming", "fallback", "stopping"].includes(generationState);
  const completedCount = rows.filter(([key]) => Boolean(analysis?.[key])).length;
  const status = generationState === "complete" ? "测定完成"
    : generationState === "cancelled" ? "已停止"
      : generationState === "fallback" ? "兼容解析"
        : loading ? "实时测定" : "待测定";
  const badgeStatus = generationState === "complete" ? "success" : loading ? "processing" : "default";

  return (
    <section className={`analysis-panel panel ${loading ? "is-loading" : ""}`}>
      <header className="panel-header">
        <div><span className="section-index">02</span><h2>视觉测定</h2></div>
        <Badge status={badgeStatus} text={status} />
      </header>
      <div className="analysis-subhead"><span>要素拆解</span><Tag size="small">已识别 {completedCount}/7 项</Tag></div>
      <div className="analysis-grid" aria-live="polite">
        {!result && generationState === "idle" ? (
          <Empty className="panel-empty" description="选择图片并开始反推" />
        ) : rows.map(([key, label, Icon]) => (
          <div className={`analysis-item ${key === "camera" ? "camera-field" : ""} ${analysis?.[key] ? "ready" : ""}`} key={key}>
            <span className="analysis-label"><Icon />{label}</span>
            <div className="analysis-value">
              {key === "colors" && analysis?.palette?.length ? (
                <div className="palette-strip" aria-label="识别色板">
                  {analysis.palette.filter(isCssColor).slice(0, 6).map((color) => <i key={color} style={{ backgroundColor: color }} title={color} />)}
                </div>
              ) : null}
              {analysis?.[key] ? <span>{analysis[key]}</span> : loading ? <Skeleton text={{ rows: 1, width: ["76%"] }} animation /> : <span>--</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="signal-line" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div>
    </section>
  );
}

function isCssColor(value: string): boolean {
  return typeof CSS === "undefined" || typeof CSS.supports !== "function" || CSS.supports("color", value);
}
