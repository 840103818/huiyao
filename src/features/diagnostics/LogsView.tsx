import { Button, Empty, Input, Message, Popconfirm, Select, Spin, Switch, Table, Tag } from "@arco-design/web-react";
import { IconCopy, IconDelete, IconDownload, IconRefresh, IconSafe, IconSearch } from "@arco-design/web-react/icon";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { clearRuntimeLogs, exportDiagnostic, exportRuntimeLogs, getErrorMessage, loadRuntimeLogs } from "../../infrastructure/tauri";
import type { RuntimeLogEntry, RuntimeLogLevel } from "../../shared/contracts";

interface LogsViewProps { requestFilter?: string }
type LevelFilter = "all" | RuntimeLogLevel;
type CategoryFilter = "all" | "model" | "system" | "storage";

export function LogsView({ requestFilter }: LogsViewProps) {
  const [message, messageContext] = Message.useMessage();
  const messageRef = useRef(message);
  messageRef.current = message;
  const [logs, setLogs] = useState<RuntimeLogEntry[]>([]);
  const [query, setQuery] = useState(requestFilter ?? "");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [expandedRowKeys, setExpandedRowKeys] = useState<(string | number)[]>([]);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try { setLogs(await loadRuntimeLogs()); }
    catch (error) { messageRef.current.error?.(getErrorMessage(error)); }
    finally { if (showLoading) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    if (!live) return;
    const timer = window.setInterval(() => void refresh(false), 5000);
    return () => window.clearInterval(timer);
  }, [live, refresh]);
  useEffect(() => { if (requestFilter) setQuery(requestFilter); }, [requestFilter]);

  const filtered = useMemo(() => logs.filter((entry) => {
    if (level !== "all" && entry.level !== level) return false;
    if (category !== "all" && entry.category !== category) return false;
    return !deferredQuery || `${entry.message} ${entry.event} ${entry.category} ${JSON.stringify(entry.details)}`.toLocaleLowerCase().includes(deferredQuery);
  }), [category, deferredQuery, level, logs]);
  const counts = useMemo(() => ({ model: logs.filter((entry) => entry.category === "model").length, error: logs.filter((entry) => entry.level === "error").length }), [logs]);

  const handleClear = async () => {
    try { await clearRuntimeLogs(); setLogs([]); message.success?.("运行日志已清空"); }
    catch (error) { message.error?.(getErrorMessage(error)); }
  };
  const handleExport = async () => {
    try { if (await exportRuntimeLogs(filtered)) message.success?.("运行日志已导出"); }
    catch (error) { message.error?.(getErrorMessage(error)); }
  };

  return (
    <main className="logs-view">
      {messageContext}
      <div className="logs-container">
        <header className="page-title-row logs-title">
          <div><span>运行诊断</span><h1>系统运行日志</h1></div>
          <Tag icon={<IconSafe />} color="green">不记录密钥、输入正文和原始图片</Tag>
        </header>
        <section className="log-summary" aria-label="日志概况">
          <div><span>全部事件</span><strong>{logs.length}</strong></div>
          <div><span>模型交互</span><strong>{counts.model}</strong></div>
          <div className={counts.error ? "has-error" : ""}><span>错误</span><strong>{counts.error}</strong></div>
        </section>
        <section className="log-toolbar">
          <Input.Search value={query} onChange={setQuery} prefix={<IconSearch />} allowClear placeholder="搜索事件、错误码或请求 ID" aria-label="搜索运行日志" />
          <Select value={category} onChange={setCategory} aria-label="按类别筛选" options={categoryOptions} />
          <Select value={level} onChange={setLevel} aria-label="按级别筛选" options={levelOptions} />
          <Button icon={<IconRefresh />} loading={loading} onClick={() => void refresh()}>刷新</Button>
          <label className="live-refresh"><Switch size="small" checked={live} onChange={setLive} />实时刷新</label>
          <Button icon={<IconDownload />} disabled={!filtered.length} onClick={() => void handleExport()}>导出</Button>
          <Popconfirm title="清空全部运行日志？" content="此操作不可撤销。" okText="清空" cancelText="取消" onOk={handleClear} disabled={!logs.length}>
            <Button status="danger" icon={<IconDelete />} disabled={!logs.length}>清空</Button>
          </Popconfirm>
        </section>
        <section className="log-table">
          <Spin loading={loading} block>
            <Table
              rowKey="id"
              size="small"
              border={{ wrapper: true, cell: false }}
              pagination={false}
              scroll={{ y: "calc(100vh - 330px)" }}
              data={filtered}
              columns={columns}
              expandedRowKeys={expandedRowKeys}
              onExpandedRowsChange={setExpandedRowKeys}
              noDataElement={<Empty description={logs.length ? "没有匹配的日志" : "暂无运行日志"} />}
              expandedRowRender={(entry) => <LogDetails entry={entry} onMessage={(value, kind) => message[kind]?.(value)} />}
              expandProps={{ expandRowByClick: true }}
            />
          </Spin>
        </section>
      </div>
    </main>
  );
}

const categoryOptions = [{ value: "all", label: "全部类别" }, { value: "model", label: "模型交互" }, { value: "system", label: "系统" }, { value: "storage", label: "存储" }];
const levelOptions = [{ value: "all", label: "全部级别" }, { value: "info", label: "信息" }, { value: "warn", label: "警告" }, { value: "error", label: "错误" }];
const columns = [
  { title: "时间", dataIndex: "timestamp", width: 174, render: (value: string) => <time dateTime={value}>{formatTimestamp(value)}</time> },
  { title: "级别", dataIndex: "level", width: 82, render: (value: RuntimeLogLevel) => <Tag color={value === "error" ? "red" : value === "warn" ? "orange" : "arcoblue"}>{levelLabel(value)}</Tag> },
  { title: "类别", dataIndex: "category", width: 82, render: (value: string) => categoryLabel(value) },
  { title: "事件", dataIndex: "event", width: 190, render: (value: string) => <code>{value}</code> },
  { title: "摘要", dataIndex: "message", ellipsis: true },
];

function LogDetails({ entry, onMessage }: { entry: RuntimeLogEntry; onMessage: (value: string, kind: "success" | "error") => void }) {
  const detailEntries = Object.entries(entry.details ?? {});
  const requestId = [entry.details.providerRequestId, entry.details.interactionId].find((value) => typeof value === "string") as string | undefined;
  const diagnosticId = typeof entry.details.diagnosticId === "string" ? entry.details.diagnosticId : undefined;
  const copyRequestId = async () => {
    if (!requestId) return;
    try { await navigator.clipboard.writeText(requestId); onMessage("请求 ID 已复制", "success"); }
    catch { onMessage("无法访问剪贴板", "error"); }
  };
  const saveDiagnostic = async () => {
    if (!diagnosticId) return;
    try { if (await exportDiagnostic(diagnosticId)) onMessage("诊断信息已导出", "success"); }
    catch (error) { onMessage(getErrorMessage(error), "error"); }
  };
  return <div className="log-detail-wrap"><dl className="log-details">{detailEntries.length ? detailEntries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{formatDetail(value)}</dd></div>) : <div><dt>details</dt><dd>--</dd></div>}</dl><div className="log-detail-actions">{requestId ? <Button size="mini" icon={<IconCopy />} onClick={() => void copyRequestId()}>复制请求 ID</Button> : null}{diagnosticId ? <Button size="mini" icon={<IconDownload />} onClick={() => void saveDiagnostic()}>导出诊断</Button> : null}</div></div>;
}
function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hour12: false });
}
function formatDetail(value: unknown): string { return value == null ? "--" : typeof value === "string" ? value : JSON.stringify(value); }
function levelLabel(level: RuntimeLogLevel): string { return level === "error" ? "错误" : level === "warn" ? "警告" : "信息"; }
function categoryLabel(category: string): string { return category === "model" ? "模型" : category === "storage" ? "存储" : category === "system" ? "系统" : category; }
