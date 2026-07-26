import { Badge, Button, Drawer, Empty, Radio, Skeleton, Tag, Tooltip } from "@arco-design/web-react";
import { IconApps, IconBulb, IconCamera, IconDown, IconEye, IconFilter, IconHighlight, IconHome, IconPalette, IconScan, IconStorage, IconUp } from "@arco-design/web-react/icon";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CaptureMetadata, GenerationState, ReverseResult } from "../../shared/contracts";

interface ResultPanelProps {
  result: ReverseResult | null;
  generationState: GenerationState;
  captureMetadata?: CaptureMetadata;
}

const rows = [
  ["subject", "主体", IconScan, "frame"],
  ["scene", "场景背景", IconHome, "frame"],
  ["composition", "构图", IconApps, "frame"],
  ["lighting", "光线", IconBulb, "light"],
  ["tonality", "影调曝光", IconHighlight, "light"],
  ["colors", "色彩", IconPalette, "light"],
  ["materials", "材质", IconStorage, "imaging"],
  ["style", "风格", IconEye, "imaging"],
  ["camera", "镜头成像", IconCamera, "imaging"],
  ["postProcessing", "后期处理", IconFilter, "imaging"],
] as const;

const groupLabels = { frame: "画面", light: "光影", imaging: "成像" } as const;
type AnalysisGroup = keyof typeof groupLabels;

const captureRows: Array<[keyof CaptureMetadata, string]> = [
  ["cameraMake", "相机品牌"], ["cameraModel", "相机型号"],
  ["lensMake", "镜头品牌"], ["lensModel", "镜头型号"],
  ["focalLength", "焦距"], ["focalLength35mm", "等效焦距"],
  ["aperture", "光圈"], ["exposureTime", "快门"], ["iso", "ISO"],
  ["exposureBias", "曝光补偿"], ["flash", "闪光灯"],
  ["whiteBalance", "白平衡"], ["capturedAt", "拍摄时间"], ["colorSpace", "色彩空间"],
];

export function ResultPanel({ result, generationState, captureMetadata }: ResultPanelProps) {
  const analysis = result?.analysis;
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [activeGroup, setActiveGroup] = useState<"all" | AnalysisGroup>("all");
  const [captureOpen, setCaptureOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const resultIdentityRef = useRef("");
  const loading = ["connecting", "streaming", "fallback", "stopping"].includes(generationState);
  const completedCount = rows.filter(([key]) => Boolean(analysis?.[key])).length;
  const expandableKeys = useMemo(() => rows
    .filter(([key]) => Array.from(analysis?.[key] ?? "").length > 72)
    .map(([key]) => key), [analysis]);
  const allExpanded = expandableKeys.length > 0 && expandableKeys.every((key) => expandedKeys.has(key));
  const status = generationState === "complete" ? "测定完成"
    : generationState === "cancelled" ? "已停止"
      : generationState === "fallback" ? "兼容解析"
        : loading ? "实时测定" : "待测定";
  const badgeStatus = generationState === "complete" ? "success" : loading ? "processing" : "default";
  const captureCount = captureRows.filter(([key]) => Boolean(captureMetadata?.[key])).length;

  useEffect(() => {
    const identity = result?.metadata.createdAt ?? "";
    const changedResult = Boolean(identity && resultIdentityRef.current && identity !== resultIdentityRef.current);
    if (!result || generationState === "connecting" || changedResult) setExpandedKeys(new Set());
    resultIdentityRef.current = identity;
  }, [generationState, result?.metadata.createdAt]);

  const toggleItem = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandableInGroup = activeGroup === "all"
    ? expandableKeys
    : rows.filter(([, , , group]) => group === activeGroup).map(([key]) => key).filter((key) => expandableKeys.includes(key));
  const groupExpanded = expandableInGroup.length > 0 && expandableInGroup.every((key) => expandedKeys.has(key));
  const toggleGroup = () => setExpandedKeys((current) => {
    const next = new Set(current);
    if (groupExpanded) expandableInGroup.forEach((key) => next.delete(key));
    else expandableInGroup.forEach((key) => next.add(key));
    return next;
  });
  const locateGroup = (group: "all" | AnalysisGroup) => {
    setActiveGroup(group);
    if (group === "all") gridRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    else gridRef.current?.querySelector<HTMLElement>(`[data-analysis-group="${group}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <section className={`analysis-panel panel ${loading ? "is-loading" : ""}`}>
      <header className="panel-header">
        <div className="analysis-title"><h2>摄影测定</h2><Tag size="small">AI 视觉推断</Tag></div>
        <div className="analysis-header-actions">
          <Button type="text" size="mini" icon={<IconCamera />} onClick={() => setCaptureOpen(true)}>文件实拍信息{captureCount ? ` ${captureCount}` : ""}</Button>
          <Badge status={badgeStatus} text={status} />
        </div>
      </header>
      <div className="analysis-subhead">
        <Radio.Group type="button" size="mini" value={activeGroup} onChange={(value) => locateGroup(value as "all" | AnalysisGroup)} aria-label="摄影测定分组定位">
          <Radio value="all">全部</Radio><Radio value="frame">画面</Radio><Radio value="light">光影</Radio><Radio value="imaging">成像</Radio>
        </Radio.Group>
        <div className="analysis-expand-actions">
          <Tag size="small">已识别 {completedCount}/{rows.length} 项</Tag>
          <Button className="analysis-expand-all" type="text" size="mini" disabled={!expandableInGroup.length} onClick={toggleGroup}>
            {groupExpanded ? "收起本组" : "展开本组"}
          </Button>
          <Button className="analysis-expand-all" type="text" size="mini" disabled={!expandableKeys.length} onClick={() => setExpandedKeys(allExpanded ? new Set() : new Set(expandableKeys))}>
            {allExpanded ? "收起全部" : "展开全部"}
          </Button>
        </div>
      </div>
      <div ref={gridRef} className="analysis-grid" aria-live="polite">
        {!result && generationState === "idle" ? (
          <Empty className="panel-empty" description="选择图片并开始反推" />
        ) : rows.map(([key, label, Icon, group], index) => {
          const value = analysis?.[key] ?? "";
          const expandable = Array.from(value).length > 72;
          const expanded = expandedKeys.has(key);
          return (
          <div className="analysis-row-group" key={key} data-analysis-group={index === 0 || rows[index - 1][3] !== group ? group : undefined}>
            {index === 0 || rows[index - 1][3] !== group ? <div className="analysis-group-heading">{groupLabels[group]}</div> : null}
          <div className={`analysis-item ${value ? "ready" : ""} ${expanded ? "is-expanded" : ""}`} data-analysis-key={key}>
            <span className="analysis-label"><Icon />{label}</span>
            <div className={`analysis-value ${key === "colors" && analysis?.palette?.length ? "has-palette" : ""}`}>
              <div className={`analysis-main ${key === "colors" && analysis?.palette?.length ? "has-palette" : ""}`}>
                {key === "colors" && analysis?.palette?.length ? (
                  <div className="palette-strip" aria-label="识别色板">
                    {analysis.palette.filter(isCssColor).slice(0, 6).map((color) => <i key={color} style={{ backgroundColor: color }} title={color} />)}
                  </div>
                ) : null}
                {value ? <span className={`analysis-text ${expanded ? "is-expanded" : ""}`}>{value}</span> : loading ? <Skeleton text={{ rows: 1, width: ["76%"] }} animation /> : <span className="analysis-placeholder">--</span>}
              </div>
              {expandable ? (
                <Tooltip content={expanded ? `收起${label}内容` : `展开${label}全文`}>
                  <Button
                    className="analysis-toggle"
                    type="text"
                    size="mini"
                    icon={expanded ? <IconUp /> : <IconDown />}
                    onClick={() => toggleItem(key)}
                    aria-expanded={expanded}
                    aria-label={expanded ? `收起${label}内容` : `展开${label}全文`}
                  />
                </Tooltip>
              ) : null}
            </div>
          </div>
          </div>
          );
        })}
      </div>
      <Drawer className="capture-metadata-drawer" width={380} title="文件实拍信息" visible={captureOpen} footer={null} unmountOnExit onCancel={() => setCaptureOpen(false)}>
        <p className="capture-privacy-note">以下内容只从本机原图 EXIF 白名单读取，不发送给模型。GPS、序列号、作者和版权字段不会保存。</p>
        {captureCount ? (
          <dl className="capture-metadata-list">
            {captureRows.map(([key, label]) => captureMetadata?.[key] ? <div key={key}><dt>{label}</dt><dd>{captureMetadata[key]}</dd></div> : null)}
          </dl>
        ) : <Empty description="文件没有可用的实拍信息" />}
      </Drawer>
    </section>
  );
}

function isCssColor(value: string): boolean {
  return typeof CSS === "undefined" || typeof CSS.supports !== "function" || CSS.supports("color", value);
}
