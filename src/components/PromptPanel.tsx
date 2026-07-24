import { Alert, Button, Empty, Tabs, Tooltip } from "@arco-design/web-react";
import { IconCopy, IconDownload, IconRefresh } from "@arco-design/web-react/icon";
import { useEffect, useRef, useState } from "react";
import type { GenerationState, ReverseResult } from "../types";

interface PromptPanelProps {
  result: ReverseResult | null;
  rawResponse?: string;
  generationState: GenerationState;
  isFinal: boolean;
  canRegenerate: boolean;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  onExport: () => void;
}

export function PromptPanel({ result, rawResponse, generationState, isFinal, canRegenerate, onCopy, onRegenerate, onExport }: PromptPanelProps) {
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const editorRef = useRef<HTMLPreElement>(null);
  const followStreamRef = useRef(true);
  const prompt = result ? (language === "zh" ? result.prompts.zh : result.prompts.en) : "";
  const loading = ["connecting", "streaming", "fallback", "stopping"].includes(generationState);

  useEffect(() => {
    if (result?.prompts.zh) setLanguage("zh");
    else if (result?.prompts.en) setLanguage("en");
  }, [result]);

  const editorContent = rawResponse || prompt;
  const characterCount = Array.from(editorContent).length;
  useEffect(() => {
    const editor = editorRef.current;
    if (loading && editor && followStreamRef.current) editor.scrollTop = editor.scrollHeight;
  }, [editorContent, loading]);

  return (
    <section className="prompt-panel panel">
      <header className="prompt-header">
        <Tabs activeTab={language} onChange={(key) => setLanguage(key as "zh" | "en")} type="text">
          <Tabs.TabPane key="zh" title="中文提示词" disabled={!result?.prompts.zh} />
          <Tabs.TabPane key="en" title="英文提示词" disabled={!result?.prompts.en} />
        </Tabs>
        <span className="prompt-format">共 {characterCount.toLocaleString("zh-CN")} 字</span>
      </header>
      <div className="code-editor">
        {rawResponse ? <Alert type="warning" content="模型响应无法解析，可复制原始响应后排查。" /> : null}
        <div className="prompt-content">
          {!editorContent && !loading ? (
            <Empty description={generationState === "cancelled" ? "生成已停止" : "尚未生成提示词"} />
          ) : (
            <pre
              ref={editorRef}
              className={rawResponse ? "raw-response" : ""}
              aria-label={rawResponse ? "原始响应" : "提示词正文"}
              onScroll={(event) => {
                const element = event.currentTarget;
                followStreamRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 28;
              }}
            >
              {editorContent || "模型正在分析…"}{loading && editorContent ? <i className="stream-caret" /> : null}
            </pre>
          )}
        </div>
        <div className="editor-actions" role="toolbar" aria-label="提示词操作">
          <Tooltip content={rawResponse ? "复制原始响应" : "复制提示词"}><Button type="primary" icon={<IconCopy />} disabled={!editorContent} onClick={() => onCopy(editorContent)}>复制</Button></Tooltip>
          <Tooltip content="重新生成"><Button icon={<IconRefresh />} disabled={loading || !canRegenerate} onClick={onRegenerate}>重新生成</Button></Tooltip>
          <Tooltip content="导出 Markdown"><Button icon={<IconDownload />} disabled={!result || !isFinal} onClick={onExport}>导出</Button></Tooltip>
        </div>
      </div>
    </section>
  );
}
