import { Alert, Button, Drawer, Dropdown, Empty, Form, Input, Menu, Message, Popconfirm, Radio, Select, Tabs, Tag, Tooltip } from "@arco-design/web-react";
import { IconCopy, IconDelete, IconDownload, IconEye, IconEdit, IconRefresh, IconSave, IconStop } from "@arco-design/web-react/icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { cancelReversePrompt, formatGeneratedAt, getActivePromptVersion, getErrorCode, getErrorMessage, runPromptOptimization } from "../../infrastructure/tauri";
import type { CommandFailure, GenerationState, PromptOptimizationOutput, PromptOptimizationTarget, PromptVersion, ResultExportFormat, ReverseResult } from "../../shared/contracts";
import { ProcessingStatus } from "../generation/ProcessingStatus";
import { parseStreamingOptimization } from "../generation/stream";

interface PromptPanelProps {
  result: ReverseResult | null;
  error?: CommandFailure;
  generationState: GenerationState;
  isFinal: boolean;
  canRegenerate: boolean;
  aspectRatio?: string;
  onCopy: (text: string) => void;
  onCopyFull?: (result: ReverseResult) => void;
  onRegenerate: () => void;
  onExport: (format: ResultExportFormat) => void;
  onResultChange?: (result: ReverseResult) => Promise<void> | void;
  onRetry?: () => void;
  onOpenSettings?: () => void;
  onOpenLogs?: (requestId?: string) => void;
  onExportDiagnostic?: (diagnosticId: string) => void;
  canSaveHistory?: boolean;
  onSaveHistory?: () => void;
}

const targetLabels: Record<PromptOptimizationTarget, string> = {
  general: "通用",
  midjourney: "Midjourney",
  flux: "Flux",
  sdxl: "SDXL",
};

export function PromptPanel({ result, error, generationState, isFinal, canRegenerate, aspectRatio, onCopy, onCopyFull, onRegenerate, onExport, onResultChange, onRetry, onOpenSettings, onOpenLogs, onExportDiagnostic, canSaveHistory, onSaveHistory }: PromptPanelProps) {
  const [message, messageContext] = Message.useMessage();
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [target, setTarget] = useState<PromptOptimizationTarget>("general");
  const [requirements, setRequirements] = useState("");
  const [sourceVersionId, setSourceVersionId] = useState("base");
  const [optimizing, setOptimizing] = useState(false);
  const [optimizationState, setOptimizationState] = useState<GenerationState>("idle");
  const [optimizationElapsedMs, setOptimizationElapsedMs] = useState(0);
  const [optimizationRequestStarted, setOptimizationRequestStarted] = useState(false);
  const [optimizationReceivedCharacters, setOptimizationReceivedCharacters] = useState(0);
  const [optimizationPartial, setOptimizationPartial] = useState<PromptOptimizationOutput>();
  const [optimizationError, setOptimizationError] = useState<string>();
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string>();
  const [editTitle, setEditTitle] = useState("");
  const [editPrompts, setEditPrompts] = useState({ zh: "", en: "" });
  const [editNegativePrompts, setEditNegativePrompts] = useState({ zh: "", en: "" });
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLeftId, setCompareLeftId] = useState("base");
  const [compareRightId, setCompareRightId] = useState("base");
  const [compareLanguage, setCompareLanguage] = useState<"zh" | "en">("zh");
  const editorRef = useRef<HTMLPreElement>(null);
  const followStreamRef = useRef(true);
  const streamBufferRef = useRef("");
  const streamFrameRef = useRef(0);
  const receivedCharactersRef = useRef(0);
  const optimizationInteractionRef = useRef<string | undefined>(undefined);
  const optimizationStartedAtRef = useRef(0);
  const optimizationCancelRequestedRef = useRef(false);
  const loading = ["connecting", "streaming", "fallback", "stopping"].includes(generationState);
  const activeVersion = result ? getActivePromptVersion(result) : undefined;
  const currentOutput = optimizationPartial ?? (activeVersion ? {
    prompts: activeVersion.prompts,
    negativePrompts: activeVersion.negativePrompts,
    metadata: activeVersion.metadata,
  } : result ? { prompts: result.prompts, negativePrompts: { zh: "", en: "" }, metadata: result.metadata } : undefined);
  const prompt = currentOutput?.prompts[language] ?? "";
  const negativePrompt = currentOutput?.negativePrompts[language] ?? "";
  const versions = result?.promptVersions ?? [];

  useEffect(() => {
    if (currentOutput?.prompts.zh) setLanguage("zh");
    else if (currentOutput?.prompts.en) setLanguage("en");
  }, [result?.metadata.createdAt]);

  useEffect(() => {
    const editor = editorRef.current;
    if ((loading || optimizing) && editor && followStreamRef.current) editor.scrollTop = editor.scrollHeight;
  }, [prompt, negativePrompt, loading, optimizing]);

  useEffect(() => () => {
    if (optimizationInteractionRef.current) void cancelReversePrompt(optimizationInteractionRef.current);
    window.cancelAnimationFrame(streamFrameRef.current);
  }, []);

  useEffect(() => {
    if (!optimizing) return;
    const timer = window.setInterval(() => setOptimizationElapsedMs(Date.now() - optimizationStartedAtRef.current), 100);
    return () => window.clearInterval(timer);
  }, [optimizing]);

  const sourceOptions = useMemo(() => [
    { label: "原始反推版本", value: "base" },
    ...versions.map((version, index) => ({ label: versionLabel(version, index), value: version.id })),
  ], [versions]);

  const selectVersion = async (value: string) => {
    if (!result || !onResultChange) return;
    try {
      setOptimizationPartial(undefined);
      await onResultChange({ ...result, activePromptVersionId: value === "base" ? undefined : value });
    } catch (cause) {
      message.error?.(`版本切换失败：${getErrorMessage(cause)}`);
    }
  };

  const deleteVersion = async () => {
    if (!result || !activeVersion || !onResultChange) return;
    try {
      const promptVersions = versions.filter((version) => version.id !== activeVersion.id);
      await onResultChange({ ...result, promptVersions, activePromptVersionId: undefined });
      message.success?.("提示词版本已删除");
    } catch (cause) {
      message.error?.(`版本删除失败：${getErrorMessage(cause)}`);
    }
  };

  const stopOptimization = async () => {
    optimizationCancelRequestedRef.current = true;
    const id = optimizationInteractionRef.current;
    setOptimizationState("stopping");
    if (id) await cancelReversePrompt(id);
  };

  const optimize = async () => {
    if (!result || optimizing || versions.length >= 8) return;
    const sourceVersion = sourceVersionId === "base" ? undefined : versions.find((version) => version.id === sourceVersionId);
    setOptimizing(true);
    setOptimizationState("connecting");
    setOptimizationElapsedMs(0);
    setOptimizationRequestStarted(false);
    setOptimizationReceivedCharacters(0);
    receivedCharactersRef.current = 0;
    optimizationCancelRequestedRef.current = false;
    optimizationStartedAtRef.current = Date.now();
    setOptimizationError(undefined);
    setOptimizationPartial(undefined);
    streamBufferRef.current = "";
    optimizationInteractionRef.current = undefined;
    try {
      const output = await runPromptOptimization({
        analysis: result.analysis,
        sourcePrompts: sourceVersion?.prompts ?? result.prompts,
        sourceNegativePrompts: sourceVersion?.negativePrompts,
        target,
        requirements,
        aspectRatio,
      }, (event) => {
        if (event.type === "started") {
          optimizationInteractionRef.current = event.interactionId;
          setOptimizationRequestStarted(true);
          if (optimizationCancelRequestedRef.current) void cancelReversePrompt(event.interactionId);
          return;
        }
        if (event.type === "fallback") {
          setOptimizationState("fallback");
          return;
        }
        if (event.type !== "delta") return;
        setOptimizationState("streaming");
        streamBufferRef.current += event.content;
        receivedCharactersRef.current += Array.from(event.content).length;
        if (!streamFrameRef.current) {
          streamFrameRef.current = window.requestAnimationFrame(() => {
            streamFrameRef.current = 0;
            setOptimizationReceivedCharacters(receivedCharactersRef.current);
            const partial = parseStreamingOptimization(streamBufferRef.current);
            if (partial) setOptimizationPartial(partial);
          });
        }
      });
      window.cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = 0;
      if (optimizationCancelRequestedRef.current) {
        setOptimizationState("cancelled");
        return;
      }
      const version: PromptVersion = {
        id: crypto.randomUUID(), target, requirements: requirements.trim(),
        origin: "optimization", sourceVersionId,
        prompts: output.prompts, negativePrompts: output.negativePrompts, metadata: output.metadata,
      };
      const next = {
        ...result,
        promptVersions: [...versions, version].slice(-8),
        activePromptVersionId: version.id,
      };
      setOptimizationState("complete");
      setOptimizationElapsedMs(output.metadata.elapsedMs);
      await onResultChange?.(next);
      setOptimizationPartial(undefined);
      setDrawerOpen(false);
      message.success?.("提示词优化完成并已保存为新版本");
    } catch (cause) {
      if (getErrorCode(cause) === "cancelled") {
        setOptimizationState("cancelled");
        message.info?.("已停止优化，当前部分内容仍可复制");
      } else {
        const text = getErrorMessage(cause);
        setOptimizationState("idle");
        setOptimizationError(text);
        message.error?.(text);
      }
    } finally {
      optimizationInteractionRef.current = undefined;
      optimizationCancelRequestedRef.current = false;
      setOptimizing(false);
    }
  };

  const editorContent = negativePrompt ? `${prompt}\n\n负面提示词\n${negativePrompt}` : prompt;
  const characterCount = Array.from(editorContent).length;
  const openManualEditor = () => {
    if (!currentOutput || versions.length >= 8) return;
    setEditError(undefined);
    setEditTitle(`手工版本 ${versions.filter((version) => version.origin === "manual").length + 1}`);
    setEditPrompts({ ...currentOutput.prompts });
    setEditNegativePrompts({ ...currentOutput.negativePrompts });
    setEditOpen(true);
  };
  const saveManualVersion = async () => {
    if (!result || !onResultChange || versions.length >= 8) return;
    const title = editTitle.trim();
    const prompts = { zh: editPrompts.zh.trim(), en: editPrompts.en.trim() };
    const negativePrompts = { zh: editNegativePrompts.zh.trim(), en: editNegativePrompts.en.trim() };
    if (!title || (!prompts.zh && !prompts.en)) return;
    const sourceMetadata = activeVersion?.metadata ?? result.metadata;
    const version: PromptVersion = {
      id: crypto.randomUUID(),
      target: activeVersion?.target ?? "general",
      origin: "manual",
      sourceVersionId: result.activePromptVersionId ?? "base",
      title,
      requirements: "",
      prompts,
      negativePrompts,
      metadata: { ...sourceMetadata, elapsedMs: 0, totalTokens: undefined, createdAt: new Date().toISOString() },
    };
    setEditSaving(true);
    setEditError(undefined);
    try {
      await onResultChange({ ...result, promptVersions: [...versions, version], activePromptVersionId: version.id });
      setEditOpen(false);
      message.success?.("手工编辑已保存为新版本");
    } catch (cause) {
      const text = getErrorMessage(cause);
      setEditError(text);
      message.error?.(`手工版本保存失败：${text}`);
    } finally {
      setEditSaving(false);
    }
  };
  const openComparison = () => {
    if (!result || !versions.length) return;
    setCompareRightId(result.activePromptVersionId ?? versions.at(-1)?.id ?? "base");
    setCompareLeftId(activeVersion?.sourceVersionId && sourceOptions.some((option) => option.value === activeVersion.sourceVersionId)
      ? activeVersion.sourceVersionId : "base");
    setCompareOpen(true);
  };
  const leftComparison = result ? promptOutputForVersion(result, compareLeftId) : undefined;
  const rightComparison = result ? promptOutputForVersion(result, compareRightId) : undefined;
  const exportMenu = (
    <Menu onClickMenuItem={(key) => onExport(key as ResultExportFormat)}>
      <Menu.Item key="markdown">Markdown 完整结果</Menu.Item>
      <Menu.Item key="json">JSON 结构化结果</Menu.Item>
      <Menu.Item key="text">纯提示词文本</Menu.Item>
    </Menu>
  );

  return (
    <section className="prompt-panel panel">
      {messageContext}
      <header className="prompt-header">
        <Tabs activeTab={language} onChange={(key) => setLanguage(key as "zh" | "en")} type="text">
          <Tabs.TabPane key="zh" title="中文提示词" disabled={!currentOutput?.prompts.zh} />
          <Tabs.TabPane key="en" title="英文提示词" disabled={!currentOutput?.prompts.en} />
        </Tabs>
        <div className="prompt-meta-actions">
          {result ? (
            <Select
              size="mini"
              className="prompt-version-select"
              aria-label="当前提示词版本"
              value={result.activePromptVersionId ?? "base"}
              options={[{ label: "原始版本", value: "base" }, ...versions.map((version, index) => ({ label: versionLabel(version, index), value: version.id }))]}
              onChange={(value) => void selectVersion(value)}
            />
          ) : null}
          {activeVersion ? (
            <Popconfirm title="删除当前优化版本？" okText="删除" cancelText="取消" onOk={() => void deleteVersion()}>
              <Button type="text" size="mini" status="danger" icon={<IconDelete />} aria-label="删除当前优化版本" />
            </Popconfirm>
          ) : null}
          <Tooltip content={versions.length >= 8 ? "每个结果最多保存 8 个派生版本" : "保留原始结果并创建可编辑副本"}>
            <Button type="text" size="mini" icon={<IconEdit />} aria-label="编辑提示词副本" disabled={!result || !isFinal || optimizing || !onResultChange || versions.length >= 8} onClick={openManualEditor} />
          </Tooltip>
          <Tooltip content="并排比较两个提示词版本">
            <Button type="text" size="mini" icon={<IconEye />} aria-label="比较提示词版本" disabled={!versions.length} onClick={openComparison} />
          </Tooltip>
          <span className="prompt-format">共 {characterCount.toLocaleString("zh-CN")} 字</span>
          {optimizationPartial ? <Tag color="orange">未完成版本</Tag> : null}
          {canSaveHistory ? <Button size="mini" icon={<IconSave />} onClick={onSaveHistory}>保存历史</Button> : null}
        </div>
      </header>
      <div className="code-editor">
        {error ? (
          <Alert type="error" title={`生成失败 · ${error.code}`} content={error.message} action={(
            <div className="error-actions">
              <Button size="mini" disabled={!onRetry} onClick={onRetry}>重试</Button>
              <Button size="mini" disabled={!onOpenSettings} onClick={onOpenSettings}>打开设置</Button>
              <Button size="mini" disabled={!onOpenLogs} onClick={() => onOpenLogs?.(error.providerRequestId ?? error.interactionId)}>查看关联日志</Button>
              {error.diagnosticId ? <Button size="mini" disabled={!onExportDiagnostic} onClick={() => onExportDiagnostic?.(error.diagnosticId!)}>导出诊断</Button> : null}
            </div>
          )} />
        ) : null}
        <div className="prompt-content">
          {!editorContent && !loading && !optimizing ? <Empty description={generationState === "cancelled" ? "生成已停止" : "尚未生成提示词"} /> : (
            <pre ref={editorRef} aria-label="提示词正文" onScroll={(event) => {
              const element = event.currentTarget;
              followStreamRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 28;
            }}>
              {editorContent || "模型正在分析…"}{(loading || optimizing) && editorContent ? <i className="stream-caret" /> : null}
            </pre>
          )}
        </div>
        <div className="editor-actions" role="toolbar" aria-label="提示词操作">
          <div className="editor-copy-actions">
            <Tooltip content="复制当前语言提示词"><Button type="primary" icon={<IconCopy />} disabled={!editorContent} onClick={() => onCopy(editorContent)}>复制提示词</Button></Tooltip>
            <Tooltip content="复制摄影测定、双语提示词和生成信息"><Button icon={<IconCopy />} disabled={!result || !isFinal || optimizing || Boolean(optimizationPartial) || !onCopyFull} onClick={() => result && onCopyFull?.(result)}>复制完整结果</Button></Tooltip>
          </div>
          <div className="editor-workflow-actions">
            <Tooltip content={versions.length >= 8 ? "每个结果最多保存 8 个派生版本" : "优化当前提示词"}><Button icon={<IconEdit />} disabled={!result || !isFinal || loading || optimizing || !onResultChange || versions.length >= 8} onClick={() => { setOptimizationState("idle"); setOptimizationError(undefined); setDrawerOpen(true); }}>优化</Button></Tooltip>
            <Tooltip content="重新生成"><Button className="compact-action" icon={<IconRefresh />} aria-label="重新生成" disabled={loading || optimizing || !canRegenerate} onClick={onRegenerate}><span>重新生成</span></Button></Tooltip>
            <Dropdown droplist={exportMenu} position="br" trigger="click" disabled={!result || !isFinal || optimizing || Boolean(optimizationPartial)}>
              <Tooltip content="选择结果导出格式"><Button className="compact-action" icon={<IconDownload />} aria-label="导出" disabled={!result || !isFinal || optimizing || Boolean(optimizationPartial)}><span>导出</span></Button></Tooltip>
            </Dropdown>
          </div>
        </div>
      </div>
      <Drawer className="optimization-drawer" width={400} title="提示词二次优化" visible={drawerOpen} maskClosable={!optimizing} escToExit={!optimizing} footer={null} onCancel={() => { if (!optimizing) setDrawerOpen(false); }}>
        <Form layout="vertical">
          <Form.Item label="目标平台">
            <Radio.Group type="button" value={target} onChange={(value) => setTarget(value as PromptOptimizationTarget)}>
              <Radio value="general">通用</Radio><Radio value="midjourney">Midjourney</Radio><Radio value="flux">Flux</Radio><Radio value="sdxl">SDXL</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="来源版本">
            <Select value={sourceVersionId} options={sourceOptions} onChange={setSourceVersionId} />
          </Form.Item>
          <Form.Item label="自定义要求">
            <Input.TextArea value={requirements} maxLength={500} showWordLimit autoSize={{ minRows: 4, maxRows: 7 }} placeholder="例如：增强商业摄影质感，保留自然肤色" onChange={setRequirements} />
          </Form.Item>
          <div className="optimization-summary">
            <span>真实宽高比</span><strong>{aspectRatio ?? "未提供"}</strong>
            <span>输出</span><strong>{target === "sdxl" ? "中英文正向与负面提示词" : "中英文正向提示词"}</strong>
          </div>
          {optimizationState !== "idle" ? (
            <ProcessingStatus
              kind="optimization"
              state={optimizationState}
              elapsedMs={optimizationElapsedMs}
              requestStarted={optimizationRequestStarted}
              receivedCharacters={optimizationReceivedCharacters}
              languageReady={{
                zh: Boolean(optimizationPartial?.prompts.zh),
                en: Boolean(optimizationPartial?.prompts.en),
                negative: target === "sdxl" ? Boolean(optimizationPartial?.negativePrompts.zh || optimizationPartial?.negativePrompts.en) : undefined,
              }}
            />
          ) : null}
          {optimizationError ? <Alert type="error" content={optimizationError} /> : null}
          <div className="optimization-actions">
            {optimizing ? <Button long status="danger" icon={<IconStop />} onClick={() => void stopOptimization()}>停止优化</Button>
              : <Button long type="primary" icon={<IconEdit />} disabled={versions.length >= 8} onClick={() => void optimize()}>开始优化</Button>}
          </div>
        </Form>
      </Drawer>
      <Drawer className="prompt-edit-drawer" width={520} title="编辑提示词副本" visible={editOpen} footer={null} unmountOnExit onCancel={() => setEditOpen(false)}>
        <Form layout="vertical">
          <Alert type="info" content="编辑会创建新的本地派生版本，不会覆盖模型原始结果。" />
          {editError ? <Alert type="error" content={`保存失败：${editError}`} /> : null}
          <Form.Item label="版本名称" required>
            <Input value={editTitle} maxLength={32} showWordLimit onChange={setEditTitle} />
          </Form.Item>
          <Form.Item label="中文提示词">
            <Input.TextArea value={editPrompts.zh} maxLength={50_000} showWordLimit autoSize={{ minRows: 7, maxRows: 14 }} onChange={(value) => setEditPrompts((current) => ({ ...current, zh: value }))} />
          </Form.Item>
          <Form.Item label="英文提示词">
            <Input.TextArea value={editPrompts.en} maxLength={50_000} showWordLimit autoSize={{ minRows: 7, maxRows: 14 }} onChange={(value) => setEditPrompts((current) => ({ ...current, en: value }))} />
          </Form.Item>
          {(activeVersion?.target === "sdxl" || editNegativePrompts.zh || editNegativePrompts.en) ? (
            <>
              <Form.Item label="中文负面提示词"><Input.TextArea value={editNegativePrompts.zh} maxLength={50_000} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(value) => setEditNegativePrompts((current) => ({ ...current, zh: value }))} /></Form.Item>
              <Form.Item label="英文负面提示词"><Input.TextArea value={editNegativePrompts.en} maxLength={50_000} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(value) => setEditNegativePrompts((current) => ({ ...current, en: value }))} /></Form.Item>
            </>
          ) : null}
          <div className="drawer-footer-actions">
            <Button disabled={editSaving} onClick={() => setEditOpen(false)}>取消</Button>
            <Button type="primary" icon={<IconSave />} loading={editSaving} disabled={!editTitle.trim() || (!editPrompts.zh.trim() && !editPrompts.en.trim())} onClick={() => void saveManualVersion()}>保存为新版本</Button>
          </div>
        </Form>
      </Drawer>
      <Drawer className="prompt-compare-drawer" width={780} title="提示词版本比较" visible={compareOpen} footer={null} unmountOnExit onCancel={() => setCompareOpen(false)}>
        <div className="compare-toolbar">
          <Select aria-label="左侧比较版本" value={compareLeftId} options={sourceOptions} onChange={setCompareLeftId} />
          <span>对比</span>
          <Select aria-label="右侧比较版本" value={compareRightId} options={sourceOptions} onChange={setCompareRightId} />
          <Radio.Group type="button" size="small" value={compareLanguage} onChange={(value) => setCompareLanguage(value as "zh" | "en")}>
            <Radio value="zh">中文</Radio><Radio value="en">英文</Radio>
          </Radio.Group>
        </div>
        <div className="prompt-comparison-grid">
          <ComparisonColumn output={leftComparison} language={compareLanguage} side="左侧" onCopy={onCopy} />
          <ComparisonColumn output={rightComparison} language={compareLanguage} side="右侧" onCopy={onCopy} />
        </div>
      </Drawer>
    </section>
  );
}

function versionLabel(version: PromptVersion, index: number): string {
  if (version.origin === "manual") return `${index + 1}. ${version.title || "手工版本"}`;
  return `${index + 1}. ${targetLabels[version.target]}`;
}

function promptOutputForVersion(result: ReverseResult, id: string) {
  if (id === "base") return {
    label: "原始反推版本",
    prompts: result.prompts,
    negativePrompts: { zh: "", en: "" },
    metadata: result.metadata,
    target: "general" as PromptOptimizationTarget,
    requirements: "",
  };
  const version = result.promptVersions?.find((candidate) => candidate.id === id);
  return version ? {
    label: version.title || targetLabels[version.target],
    prompts: version.prompts,
    negativePrompts: version.negativePrompts,
    metadata: version.metadata,
    target: version.target,
    requirements: version.requirements,
  } : undefined;
}

function ComparisonColumn({ output, language, side, onCopy }: {
  output?: ReturnType<typeof promptOutputForVersion>;
  language: "zh" | "en";
  side: "左侧" | "右侧";
  onCopy: (text: string) => void;
}) {
  const positive = output?.prompts[language] ?? "";
  const negative = output?.negativePrompts[language] ?? "";
  const copyText = negative ? `${positive}\n\n负面提示词\n${negative}` : positive;
  return (
    <article className="comparison-column">
      <header>
        <strong>{output?.label ?? "版本不可用"}</strong>
        <div><span>{Array.from(`${positive}${negative}`).length.toLocaleString("zh-CN")} 字</span><Button type="text" size="mini" icon={<IconCopy />} aria-label={`复制${side}版本`} disabled={!copyText} onClick={() => onCopy(copyText)}>复制</Button></div>
      </header>
      {output ? <div className="comparison-meta"><span>平台 {targetLabels[output.target]}</span><span>生成 {formatGeneratedAt(output.metadata.createdAt)}</span>{output.requirements ? <span title={output.requirements}>要求 {output.requirements}</span> : null}</div> : null}
      <pre>{positive || "该语言没有内容"}</pre>
      {negative ? <><h4>负面提示词</h4><pre>{negative}</pre></> : null}
    </article>
  );
}
