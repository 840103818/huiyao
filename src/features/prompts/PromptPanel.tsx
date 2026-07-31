import { Alert, Button, Drawer, Dropdown, Empty, Form, Input, Menu, Message, Radio, Select, Tabs, Tag, Tooltip } from "@arco-design/web-react";
import { IconCopy, IconDownload, IconEdit, IconRefresh, IconSave, IconStop } from "@arco-design/web-react/icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { cancelReversePrompt, getErrorCode, getErrorMessage, runPromptOptimization } from "../../infrastructure/tauri";
import type { CommandFailure, GenerationState, PromptOptimizationOutput, PromptOptimizationTarget, ResultExportFormat, ResultRevision, ReverseResult } from "../../shared/contracts";
import { activeResultRevision, activeResultView, appendRevision, MAX_RESULT_REVISIONS, resultRevisions, revisionLabel } from "../analysis/revisions";
import { ProcessingStatus } from "../generation/ProcessingStatus";
import { createStreamPrinterController, parseStreamingOptimization } from "../generation/stream";

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
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

const targetLabels: Record<PromptOptimizationTarget, string> = {
  general: "通用",
  midjourney: "Midjourney",
  flux: "Flux",
  sdxl: "SDXL",
};

export function PromptPanel({ result, error, generationState, isFinal, canRegenerate, aspectRatio, onCopy, onCopyFull, onRegenerate, onExport, onResultChange, onRetry, onOpenSettings, onOpenLogs, onExportDiagnostic, canSaveHistory, onSaveHistory, disabled = false, onBusyChange }: PromptPanelProps) {
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
  const editorRef = useRef<HTMLPreElement>(null);
  const followStreamRef = useRef(true);
  const receivedCharactersRef = useRef(0);
  const streamPrinterRef = useRef<ReturnType<typeof createStreamPrinterController> | null>(null);
  if (!streamPrinterRef.current) {
    streamPrinterRef.current = createStreamPrinterController((content) => {
      setOptimizationReceivedCharacters(receivedCharactersRef.current);
      const partial = parseStreamingOptimization(content);
      if (partial) setOptimizationPartial(partial);
    });
  }
  const optimizationInteractionRef = useRef<string | undefined>(undefined);
  const optimizationStartedAtRef = useRef(0);
  const optimizationCancelRequestedRef = useRef(false);
  const loading = ["connecting", "streaming", "fallback", "stopping"].includes(generationState);
  const activeVersion = result ? activeResultRevision(result) : undefined;
  const activeView = result ? activeResultView(result) : undefined;
  const currentOutput = optimizationPartial ?? (activeVersion ? {
    prompts: activeVersion.prompts,
    negativePrompts: activeVersion.negativePrompts,
    metadata: activeVersion.metadata,
  } : activeView ? { prompts: activeView.prompts, negativePrompts: { zh: "", en: "" }, metadata: activeView.metadata } : undefined);
  const prompt = currentOutput?.prompts[language] ?? "";
  const negativePrompt = currentOutput?.negativePrompts[language] ?? "";
  const versions = result ? resultRevisions(result) : [];

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
    streamPrinterRef.current?.reset();
  }, []);
  useEffect(() => {
    if (disabled && !optimizing) setDrawerOpen(false);
  }, [disabled, optimizing]);

  useEffect(() => {
    if (!optimizing) return;
    const timer = window.setInterval(() => setOptimizationElapsedMs(Date.now() - optimizationStartedAtRef.current), 100);
    return () => window.clearInterval(timer);
  }, [optimizing]);
  useEffect(() => {
    onBusyChange?.(optimizing);
    return () => onBusyChange?.(false);
  }, [onBusyChange, optimizing]);

  const sourceOptions = useMemo(() => [
    { label: "原始结果", value: "base" },
    ...versions.map((version, index) => ({ label: revisionLabel(version, index), value: version.id })),
  ], [versions]);

  const stopOptimization = async () => {
    optimizationCancelRequestedRef.current = true;
    const id = optimizationInteractionRef.current;
    setOptimizationState("stopping");
    if (id) await cancelReversePrompt(id);
  };

  const optimize = async () => {
    if (!result || optimizing || versions.length >= MAX_RESULT_REVISIONS) return;
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
    streamPrinterRef.current?.reset();
    optimizationInteractionRef.current = undefined;
    try {
      const output = await runPromptOptimization({
        analysis: sourceVersion?.analysis ?? result.analysis,
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
        receivedCharactersRef.current += Array.from(event.content).length;
        streamPrinterRef.current?.append(event.content);
      });
      if (optimizationCancelRequestedRef.current) {
        streamPrinterRef.current?.flush();
        setOptimizationState("cancelled");
        return;
      }
      await streamPrinterRef.current?.finish();
      const version: ResultRevision = {
        id: crypto.randomUUID(), target, requirements: requirements.trim(),
        origin: "optimization", sourceRevisionId: sourceVersionId === "base" ? undefined : sourceVersionId,
        analysis: sourceVersion?.analysis ?? result.analysis, lockedFields: sourceVersion?.lockedFields ?? [],
        prompts: output.prompts, negativePrompts: output.negativePrompts, metadata: output.metadata, syncState: "synced",
      };
      const next = appendRevision(result, version);
      setOptimizationState("complete");
      setOptimizationElapsedMs(output.metadata.elapsedMs);
      await onResultChange?.(next);
      setOptimizationPartial(undefined);
      setDrawerOpen(false);
      message.success?.("提示词优化完成并已保存为新修订");
    } catch (cause) {
      if (getErrorCode(cause) === "cancelled") {
        streamPrinterRef.current?.flush();
        setOptimizationState("cancelled");
        message.info?.("已停止优化，当前部分内容仍可复制");
      } else {
        streamPrinterRef.current?.flush();
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
          <span className="prompt-format">共 {characterCount.toLocaleString("zh-CN")} 字</span>
          {optimizationPartial ? <Tag color="orange">未完成版本</Tag> : null}
          {canSaveHistory ? <Button size="mini" icon={<IconSave />} disabled={disabled} onClick={onSaveHistory}>保存历史</Button> : null}
        </div>
      </header>
      <div className="code-editor">
        {error ? (
          <Alert type="error" title={`生成失败 · ${error.code}`} content={error.message} action={(
            <div className="error-actions">
              <Button size="mini" disabled={disabled || !onRetry} onClick={onRetry}>重试</Button>
              <Button size="mini" disabled={disabled || !onOpenSettings} onClick={onOpenSettings}>打开设置</Button>
              <Button size="mini" disabled={disabled || !onOpenLogs} onClick={() => onOpenLogs?.(error.providerRequestId ?? error.interactionId)}>查看关联日志</Button>
              {error.diagnosticId ? <Button size="mini" disabled={disabled || !onExportDiagnostic} onClick={() => onExportDiagnostic?.(error.diagnosticId!)}>导出诊断</Button> : null}
            </div>
          )} />
        ) : null}
        <div className="prompt-content">
          {!editorContent && !loading && !optimizing ? <Empty description={generationState === "cancelled" ? "生成已停止" : "尚未生成提示词"} /> : (
            <pre ref={editorRef} aria-label="提示词正文" aria-busy={loading || optimizing} aria-live={loading || optimizing ? "off" : "polite"} onScroll={(event) => {
              const element = event.currentTarget;
              followStreamRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 28;
            }}>
              {editorContent || "模型正在分析…"}{(loading || optimizing) && editorContent ? <i className="stream-caret" /> : null}
            </pre>
          )}
        </div>
        <div className="editor-actions" role="toolbar" aria-label="提示词操作">
          <div className="editor-copy-actions">
            <Tooltip content="复制当前语言提示词"><Button type="primary" icon={<IconCopy />} disabled={disabled || !editorContent} onClick={() => onCopy(editorContent)}>复制提示词</Button></Tooltip>
            <Tooltip content="复制摄影测定、双语提示词和生成信息"><Button icon={<IconCopy />} disabled={disabled || !result || !isFinal || optimizing || Boolean(optimizationPartial) || !onCopyFull} onClick={() => result && onCopyFull?.(result)}>复制完整结果</Button></Tooltip>
          </div>
          <div className="editor-workflow-actions">
            <Tooltip content={versions.length >= MAX_RESULT_REVISIONS ? `每个结果最多保存 ${MAX_RESULT_REVISIONS} 个派生修订` : "优化当前提示词"}><Button icon={<IconEdit />} disabled={disabled || !result || !isFinal || loading || optimizing || !onResultChange || versions.length >= MAX_RESULT_REVISIONS} onClick={() => { setSourceVersionId(activeVersion?.id ?? "base"); setOptimizationState("idle"); setOptimizationError(undefined); setDrawerOpen(true); }}>优化</Button></Tooltip>
            <Tooltip content="重新分析"><Button className="compact-action" icon={<IconRefresh />} aria-label="重新分析" disabled={disabled || loading || optimizing || !canRegenerate} onClick={onRegenerate}><span>重新分析</span></Button></Tooltip>
            <Dropdown droplist={exportMenu} position="br" trigger="click" disabled={disabled || !result || !isFinal || optimizing || Boolean(optimizationPartial)}>
              <Tooltip content="选择结果导出格式"><Button className="compact-action" icon={<IconDownload />} aria-label="导出" disabled={disabled || !result || !isFinal || optimizing || Boolean(optimizationPartial)}><span>导出</span></Button></Tooltip>
            </Dropdown>
          </div>
        </div>
      </div>
      <Drawer className="optimization-drawer" width={400} title="提示词二次优化" visible={drawerOpen} maskClosable={!optimizing} escToExit={!optimizing} footer={null} onCancel={() => { if (!optimizing) setDrawerOpen(false); }}>
        <Form layout="vertical">
          <Form.Item label="目标平台">
            <Radio.Group type="button" value={target} disabled={optimizing} onChange={(value) => setTarget(value as PromptOptimizationTarget)}>
              <Radio value="general">通用</Radio><Radio value="midjourney">Midjourney</Radio><Radio value="flux">Flux</Radio><Radio value="sdxl">SDXL</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="来源版本">
            <Select value={sourceVersionId} options={sourceOptions} disabled={optimizing} onChange={setSourceVersionId} />
          </Form.Item>
          <Form.Item label="自定义要求">
            <Input.TextArea value={requirements} maxLength={500} showWordLimit disabled={optimizing} autoSize={{ minRows: 4, maxRows: 7 }} placeholder="例如：增强商业摄影质感，保留自然肤色" onChange={setRequirements} />
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
              : <Button long type="primary" icon={<IconEdit />} disabled={versions.length >= MAX_RESULT_REVISIONS} onClick={() => void optimize()}>开始优化</Button>}
          </div>
        </Form>
      </Drawer>
    </section>
  );
}
