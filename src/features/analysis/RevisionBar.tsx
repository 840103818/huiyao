import { Alert, Button, Drawer, Dropdown, Form, Input, Menu, Popconfirm, Select, Tabs, Tag, Tooltip } from "@arco-design/web-react";
import { IconCheck, IconDelete, IconEdit, IconEye, IconLock, IconRefresh, IconRobot, IconSave, IconUnlock } from "@arco-design/web-react/icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { cancelReversePrompt, getCommandFailure, runAnalysisRefinement, runPromptOptimization } from "../../infrastructure/tauri";
import type { Analysis, AnalysisFieldKey, CaptureMetadata, CommandFailure, ResultRevision, ReverseResult, ReverseStreamEvent } from "../../shared/contracts";
import { createStreamPrinterController, parseStreamingResult } from "../generation/stream";
import { activeResultRevision, activeResultView, appendRevision, MAX_RESULT_REVISIONS, removeRevision, resultRevisions, revisionLabel, revisionRemovalIds, revisionTarget, withActiveRevision } from "./revisions";

const fieldMeta: Array<[AnalysisFieldKey, string, "画面" | "光影" | "成像"]> = [
  ["subject", "主体", "画面"], ["scene", "场景背景", "画面"], ["composition", "构图", "画面"],
  ["lighting", "光线", "光影"], ["tonality", "影调曝光", "光影"], ["colors", "色彩", "光影"],
  ["materials", "材质", "成像"], ["style", "风格", "成像"], ["camera", "镜头成像", "成像"], ["postProcessing", "后期处理", "成像"],
];

const originLabels: Record<ResultRevision["origin"], string> = {
  manualAnalysis: "人工校正", aiRefinement: "AI 重测", promptEdit: "提示词编辑", optimization: "平台优化",
};

interface RevisionBarProps {
  result: ReverseResult | null;
  isFinal: boolean;
  imageDataUrl?: string;
  hasApiKey?: boolean;
  captureMetadata?: CaptureMetadata;
  onResultChange?: (result: ReverseResult) => Promise<void> | void;
  onCopy: (text: string) => void;
  onOpenLogs?: (requestId?: string) => void;
  onExportDiagnostic?: (diagnosticId: string) => void;
  refineRequestId?: number;
  previewInteraction?: "compare";
}

export function RevisionBar({ result, isFinal, imageDataUrl, hasApiKey, captureMetadata, onResultChange, onCopy, onOpenLogs, onExportDiagnostic, refineRequestId = 0, previewInteraction }: RevisionBarProps) {
  const revisions = result ? resultRevisions(result) : [];
  const active = result ? activeResultRevision(result) : undefined;
  const view = result ? activeResultView(result) : undefined;
  const [editorOpen, setEditorOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(previewInteraction === "compare");
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptTitle, setPromptTitle] = useState("");
  const [promptDraft, setPromptDraft] = useState({ zh: "", en: "", negativeZh: "", negativeEn: "" });
  const [draftAnalysis, setDraftAnalysis] = useState<Analysis>();
  const [locked, setLocked] = useState<Set<AnalysisFieldKey>>(new Set());
  const [title, setTitle] = useState("");
  const [requirements, setRequirements] = useState("");
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<CommandFailure>();
  const [interactionId, setInteractionId] = useState<string>();
  const [lastInteractionId, setLastInteractionId] = useState<string>();
  const [compareLeft, setCompareLeft] = useState(active?.sourceRevisionId ?? "base");
  const [compareRight, setCompareRight] = useState(active?.id ?? "base");
  const [compareTab, setCompareTab] = useState("analysis");
  const handledRefineRequestRef = useRef(0);
  const lockedRef = useRef(locked);
  const refinementPrinterRef = useRef(createStreamPrinterController((content) => {
    const partial = parseStreamingResult(content);
    if (partial) setDraftAnalysis((current) => current ? preserveLockedFields(partial.analysis, current, lockedRef.current) : partial.analysis);
  }));

  useEffect(() => { lockedRef.current = locked; }, [locked]);
  useEffect(() => () => refinementPrinterRef.current.cancel(), []);

  const options = useMemo(() => [
    { label: "原始结果", value: "base" },
    ...revisions.map((revision, index) => ({ label: revisionLabel(revision, index), value: revision.id })),
  ], [revisions]);

  const persist = async (next: ReverseResult) => {
    if (!onResultChange) return;
    await onResultChange(next);
  };

  const openEditor = () => {
    if (!view) return;
    setDraftAnalysis(structuredClone(view.analysis));
    setLocked(new Set(active?.lockedFields ?? []));
    setTitle(`校正版本 ${revisions.filter((revision) => revision.origin === "manualAnalysis" || revision.origin === "aiRefinement").length + 1}`);
    setRequirements("");
    setError(undefined);
    setEditorOpen(true);
  };

  useEffect(() => {
    if (refineRequestId <= handledRefineRequestRef.current || !view) return;
    handledRefineRequestRef.current = refineRequestId;
    openEditor();
  }, [refineRequestId, result]);

  useEffect(() => {
    if (previewInteraction !== "compare" || !active) return;
    setCompareLeft(active.sourceRevisionId ?? "base");
    setCompareRight(active.id);
  }, [active?.id, previewInteraction, result]);

  const makeRevision = (analysis: Analysis, origin: ResultRevision["origin"], metadata = view?.metadata): ResultRevision => ({
    id: crypto.randomUUID(),
    title: title.trim() || (origin === "aiRefinement" ? "AI 重测" : "人工校正"),
    origin,
    sourceRevisionId: active?.id,
    analysis,
    lockedFields: Array.from(locked),
    prompts: active?.prompts ?? result?.prompts ?? { zh: "", en: "" },
    negativePrompts: active?.negativePrompts ?? { zh: "", en: "" },
    target: active?.target,
    requirements: requirements.trim(),
    syncState: "local",
    metadata: metadata ? { ...metadata, createdAt: new Date().toISOString(), elapsedMs: origin === "manualAnalysis" ? 0 : metadata.elapsedMs } : { model: "local", elapsedMs: 0, createdAt: new Date().toISOString() },
  });

  const saveDraft = async () => {
    if (!result || !draftAnalysis || revisions.length >= MAX_RESULT_REVISIONS) return;
    setSaving(true);
    setError(undefined);
    try {
      await persist(appendRevision(result, makeRevision(draftAnalysis, "manualAnalysis")));
      setEditorOpen(false);
    } catch (cause) {
      setError(getCommandFailure(cause));
    } finally {
      setSaving(false);
    }
  };

  const refineWithAi = async () => {
    if (!result || !draftAnalysis || !imageDataUrl || !hasApiKey || revisions.length >= MAX_RESULT_REVISIONS) return;
    setRefining(true);
    setError(undefined);
    setLastInteractionId(undefined);
    refinementPrinterRef.current.reset();
    const currentAnalysis = structuredClone(draftAnalysis);
    const lockedFields = new Set(locked);
    try {
      const output = await runAnalysisRefinement({
        imageDataUrl,
        currentAnalysis,
        lockedFields: Array.from(lockedFields),
        requirements: requirements.trim(),
      }, (event: ReverseStreamEvent) => {
        if (event.type === "started") {
          setInteractionId(event.interactionId);
          setLastInteractionId(event.interactionId);
        } else if (event.type === "delta") {
          refinementPrinterRef.current.append(event.content);
        }
      });
      await refinementPrinterRef.current.finish();
      setDraftAnalysis(output.analysis);
      await persist(appendRevision(result, makeRevision(output.analysis, "aiRefinement", output.metadata)));
      setEditorOpen(false);
    } catch (cause) {
      refinementPrinterRef.current.flush();
      setError(getCommandFailure(cause));
    } finally {
      setInteractionId(undefined);
      setRefining(false);
    }
  };

  const syncPrompts = async () => {
    if (!result || !active || !hasApiKey || syncing) return;
    setSyncing(true);
    setError(undefined);
    setLastInteractionId(undefined);
    try {
      const output = await runPromptOptimization({
        analysis: active.analysis,
        sourcePrompts: active.prompts,
        sourceNegativePrompts: active.negativePrompts,
        target: revisionTarget(active),
        requirements: "根据校正后的摄影测定同步更新提示词，保持主体事实与原版本意图。",
      }, (event) => {
        if (event.type === "started") {
          setInteractionId(event.interactionId);
          setLastInteractionId(event.interactionId);
        }
      });
      const next = revisions.map((revision) => revision.id === active.id ? {
        ...revision, prompts: output.prompts, negativePrompts: output.negativePrompts,
        metadata: output.metadata, syncState: "synced" as const,
      } : revision);
      await persist({ ...result, resultRevisions: next, activeResultRevisionId: active.id });
    } catch (cause) {
      const next = revisions.map((revision) => revision.id === active.id ? { ...revision, syncState: "failed" as const } : revision);
      await persist({ ...result, resultRevisions: next, activeResultRevisionId: active.id }).catch(() => undefined);
      setError(getCommandFailure(cause));
    } finally {
      setInteractionId(undefined);
      setSyncing(false);
    }
  };

  const adoptExif = () => {
    if (!draftAnalysis || !captureMetadata) return;
    const camera = [
      captureMetadata.cameraMake, captureMetadata.cameraModel, captureMetadata.lensModel,
      captureMetadata.focalLength, captureMetadata.aperture, captureMetadata.exposureTime,
      captureMetadata.iso ? `ISO ${captureMetadata.iso}` : undefined,
    ].filter(Boolean).join("，");
    if (!camera) return;
    setDraftAnalysis({ ...draftAnalysis, camera });
    setLocked((current) => new Set(current).add("camera"));
  };

  const comparison = (id: string) => {
    if (!result) return undefined;
    if (id === "base") return { label: "原始结果", analysis: result.analysis, prompts: result.prompts, negativePrompts: { zh: "", en: "" } };
    const revision = revisions.find((item) => item.id === id);
    return revision ? { label: revision.title || originLabels[revision.origin], analysis: revision.analysis, prompts: revision.prompts, negativePrompts: revision.negativePrompts } : undefined;
  };
  const left = comparison(compareLeft);
  const right = comparison(compareRight);

  const openPromptEditor = () => {
    if (!view) return;
    setPromptTitle(`提示词修订 ${revisions.filter((revision) => revision.origin === "promptEdit").length + 1}`);
    setPromptDraft({
      zh: active?.prompts.zh ?? view.prompts.zh,
      en: active?.prompts.en ?? view.prompts.en,
      negativeZh: active?.negativePrompts.zh ?? "",
      negativeEn: active?.negativePrompts.en ?? "",
    });
    setPromptEditorOpen(true);
  };

  const savePromptRevision = async () => {
    if (!result || !view || revisions.length >= MAX_RESULT_REVISIONS) return;
    setSaving(true);
    try {
      await persist(appendRevision(result, {
        id: crypto.randomUUID(), title: promptTitle.trim() || "提示词编辑", origin: "promptEdit",
        sourceRevisionId: active?.id, analysis: view.analysis, lockedFields: active?.lockedFields ?? [],
        prompts: { zh: promptDraft.zh.trim(), en: promptDraft.en.trim() },
        negativePrompts: { zh: promptDraft.negativeZh.trim(), en: promptDraft.negativeEn.trim() },
        target: active?.target, requirements: "", syncState: "synced",
        metadata: { ...view.metadata, elapsedMs: 0, totalTokens: undefined, createdAt: new Date().toISOString() },
      }));
      setPromptEditorOpen(false);
    } catch (cause) {
      setError(getCommandFailure(cause));
    } finally {
      setSaving(false);
    }
  };

  const moreMenu = <Menu onClickMenuItem={(key) => {
    if (key === "compare") {
      setCompareLeft(active?.sourceRevisionId ?? "base");
      setCompareRight(active?.id ?? revisions.at(-1)?.id ?? "base");
      setCompareOpen(true);
    }
    if (key === "prompt-edit") openPromptEditor();
  }}><Menu.Item key="prompt-edit" disabled={!result || !isFinal || revisions.length >= MAX_RESULT_REVISIONS}><IconEdit />编辑提示词副本</Menu.Item><Menu.Item key="compare" disabled={!revisions.length}><IconEye />比较修订</Menu.Item></Menu>;
  const removalCount = active ? revisionRemovalIds(revisions, active.id).size : 0;
  const errorContent = error ? <div className="revision-error-content">
    <span>{error.message}（{error.code}）</span>
    <div>
      {lastInteractionId && onOpenLogs ? <Button size="mini" type="text" onClick={() => onOpenLogs(lastInteractionId)}>查看关联日志</Button> : null}
      {error.diagnosticId && onExportDiagnostic ? <Button size="mini" type="text" onClick={() => onExportDiagnostic(error.diagnosticId!)}>导出诊断</Button> : null}
    </div>
  </div> : null;

  return (
    <>
      <div className="revision-bar" role="toolbar" aria-label="结果修订">
        <div className="revision-context">
          <span>当前修订</span>
          <Select size="mini" aria-label="当前结果修订" value={active?.id ?? "base"} options={options} disabled={!result} onChange={(id) => result && void persist(withActiveRevision(result, id === "base" ? undefined : id))} />
          {active ? <Tag className={`revision-sync revision-sync-${active.syncState}`}>{active.syncState === "synced" ? "已同步" : active.syncState === "failed" ? "同步失败" : "本地草稿"}</Tag> : <Tag>模型原始结果</Tag>}
        </div>
        <div className="revision-actions">
          {active && active.syncState !== "synced" ? <Button size="mini" type="primary" icon={<IconRefresh />} loading={syncing} disabled={!hasApiKey} onClick={() => void syncPrompts()}>同步提示词</Button> : null}
          <Dropdown trigger="click" position="br" droplist={moreMenu}><Button size="mini" type="text" aria-label="修订更多操作">•••</Button></Dropdown>
          {active ? <Popconfirm title="删除当前修订？" content={removalCount > 1 ? `将同时删除 ${removalCount - 1} 个依赖它的后续修订，此操作无法撤销。` : "此操作无法撤销。"} okText="删除" cancelText="取消" onOk={async () => {
            if (!result) return;
            try { await persist(removeRevision(result, active.id)); } catch (cause) { setError(getCommandFailure(cause)); }
          }}><Tooltip content="删除当前修订"><Button size="mini" type="text" status="danger" icon={<IconDelete />} aria-label="删除当前修订" /></Tooltip></Popconfirm> : null}
        </div>
      </div>
      {error && !editorOpen ? <Alert className="revision-error" type="error" content={errorContent} closable onClose={() => setError(undefined)} /> : null}
      <Drawer className="analysis-refinement-drawer" width={560} title="校正摄影测定" visible={editorOpen} footer={null} maskClosable={!saving && !refining} escToExit={!saving && !refining} unmountOnExit onCancel={() => { if (!saving && !refining) setEditorOpen(false); }}>
        <Form layout="vertical">
          <Alert type="info" content="修改字段会自动锁定。先保存本地草稿，再按需同步提示词。" />
          <Form.Item label="修订名称"><Input value={title} maxLength={32} showWordLimit disabled={saving || refining} onChange={setTitle} /></Form.Item>
          {["画面", "光影", "成像"].map((group) => <section className="refinement-group" key={group}>
            <header><strong>{group}</strong>{group === "成像" && captureMetadata ? <Button size="mini" type="text" icon={<IconCheck />} disabled={saving || refining} onClick={adoptExif}>采用实拍参数</Button> : null}</header>
            {fieldMeta.filter(([, , fieldGroup]) => fieldGroup === group).map(([key, label]) => {
              const isLocked = locked.has(key);
              return <Form.Item key={key} label={<span className="refinement-label">{label}<Tooltip content={isLocked ? "已锁定，AI 重测不会修改" : "未锁定，AI 重测可以更新"}><Button type="text" size="mini" disabled={saving || refining} icon={isLocked ? <IconLock /> : <IconUnlock />} aria-label={`${isLocked ? "解锁" : "锁定"}${label}`} onClick={() => setLocked((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })} /></Tooltip></span>}>
                <Input.TextArea value={draftAnalysis?.[key] ?? ""} maxLength={8_000} disabled={saving || refining} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => {
                  setDraftAnalysis((current) => current ? { ...current, [key]: value } : current);
                  setLocked((current) => new Set(current).add(key));
                }} />
              </Form.Item>;
            })}
            {group === "光影" ? <Form.Item label="色板"><Input value={draftAnalysis?.palette.join(", ") ?? ""} placeholder="#FFFFFF, #1F1F1F" disabled={saving || refining} onChange={(value) => {
              setDraftAnalysis((current) => current ? { ...current, palette: value.split(/[,，\s]+/).filter(Boolean).slice(0, 12) } : current);
              setLocked((current) => new Set(current).add("colors"));
            }} /></Form.Item> : null}
          </section>)}
          <Form.Item label="AI 重测要求"><Input.TextArea value={requirements} maxLength={500} showWordLimit disabled={saving || refining} autoSize={{ minRows: 3, maxRows: 5 }} placeholder="仅补充本轮需要重点复核的内容" onChange={setRequirements} /></Form.Item>
          {error ? <Alert type="error" content={errorContent} /> : null}
          <div className="drawer-footer-actions refinement-actions">
            {refining && interactionId ? <Button status="danger" onClick={() => void cancelReversePrompt(interactionId)}>停止重测</Button> : <Button icon={<IconRobot />} loading={refining} disabled={!imageDataUrl || !hasApiKey || saving} onClick={() => void refineWithAi()}>AI 重测未锁定字段</Button>}
            <Button type="primary" icon={<IconSave />} loading={saving} disabled={refining} onClick={() => void saveDraft()}>保存本地草稿</Button>
          </div>
          {!imageDataUrl ? <small className="refinement-hint">当前任务没有可用原图，只能进行人工校正。</small> : !hasApiKey ? <small className="refinement-hint">配置模型服务后可使用 AI 重测，本地草稿仍可保存。</small> : null}
        </Form>
      </Drawer>
      <Drawer className="revision-compare-drawer" width={900} title="结果修订比较" visible={compareOpen} footer={null} unmountOnExit onCancel={() => setCompareOpen(false)}>
        <div className="compare-toolbar"><Select value={compareLeft} options={options} onChange={setCompareLeft} /><span>对比</span><Select value={compareRight} options={options} onChange={setCompareRight} /></div>
        <Tabs activeTab={compareTab} onChange={setCompareTab} type="line">
          <Tabs.TabPane key="analysis" title="摄影测定" />
          <Tabs.TabPane key="prompts" title="提示词" />
        </Tabs>
        <div className="revision-comparison-grid">
          {[left, right].map((item, index) => <article key={index} className="revision-comparison-column"><header><strong>{item?.label ?? "修订不可用"}</strong></header>{compareTab === "analysis" ? fieldMeta.map(([key, label]) => <div className="revision-field" key={key}><span>{label}</span><p>{item?.analysis[key] || "--"}</p></div>) : <><h4>中文提示词</h4><pre>{item?.prompts.zh || "--"}</pre><h4>英文提示词</h4><pre>{item?.prompts.en || "--"}</pre><Button icon={<IconSave />} disabled={!item} onClick={() => item && onCopy(`${item.prompts.zh}\n\n${item.prompts.en}`)}>复制当前列</Button></>}</article>)}
        </div>
      </Drawer>
      <Drawer className="prompt-edit-drawer" width={560} title="编辑提示词副本" visible={promptEditorOpen} footer={null} unmountOnExit onCancel={() => setPromptEditorOpen(false)}>
        <Form layout="vertical">
          <Alert type="info" content="编辑会创建统一派生修订，不会覆盖模型原始结果或来源修订。" />
          <Form.Item label="修订名称"><Input value={promptTitle} maxLength={32} showWordLimit onChange={setPromptTitle} /></Form.Item>
          <Form.Item label="中文提示词"><Input.TextArea value={promptDraft.zh} maxLength={50_000} showWordLimit autoSize={{ minRows: 7, maxRows: 14 }} onChange={(zh) => setPromptDraft((current) => ({ ...current, zh }))} /></Form.Item>
          <Form.Item label="英文提示词"><Input.TextArea value={promptDraft.en} maxLength={50_000} showWordLimit autoSize={{ minRows: 7, maxRows: 14 }} onChange={(en) => setPromptDraft((current) => ({ ...current, en }))} /></Form.Item>
          {(active?.target === "sdxl" || promptDraft.negativeZh || promptDraft.negativeEn) ? <><Form.Item label="中文负面提示词"><Input.TextArea value={promptDraft.negativeZh} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(negativeZh) => setPromptDraft((current) => ({ ...current, negativeZh }))} /></Form.Item><Form.Item label="英文负面提示词"><Input.TextArea value={promptDraft.negativeEn} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(negativeEn) => setPromptDraft((current) => ({ ...current, negativeEn }))} /></Form.Item></> : null}
          <div className="drawer-footer-actions"><Button onClick={() => setPromptEditorOpen(false)}>取消</Button><Button type="primary" icon={<IconSave />} loading={saving} disabled={!promptTitle.trim() || (!promptDraft.zh.trim() && !promptDraft.en.trim())} onClick={() => void savePromptRevision()}>保存为新修订</Button></div>
        </Form>
      </Drawer>
    </>
  );
}

function preserveLockedFields(next: Analysis, current: Analysis, locked: Set<AnalysisFieldKey>): Analysis {
  const merged: Analysis = {
    subject: next.subject || current.subject,
    scene: next.scene || current.scene,
    composition: next.composition || current.composition,
    lighting: next.lighting || current.lighting,
    tonality: next.tonality || current.tonality,
    colors: next.colors || current.colors,
    palette: next.palette.length ? [...next.palette] : [...current.palette],
    materials: next.materials || current.materials,
    style: next.style || current.style,
    camera: next.camera || current.camera,
    postProcessing: next.postProcessing || current.postProcessing,
  };
  for (const key of locked) {
    if (key === "colors") {
      merged.colors = current.colors;
      merged.palette = [...current.palette];
    } else {
      merged[key] = current[key];
    }
  }
  return merged;
}
