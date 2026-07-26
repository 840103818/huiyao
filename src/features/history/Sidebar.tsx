import { Badge, Button, Dropdown, Empty, Input, Menu, Modal, Popconfirm, Tooltip } from "@arco-design/web-react";
import { IconCopy, IconDelete, IconDownload, IconEdit, IconImage, IconSearch } from "@arco-design/web-react/icon";
import { useDeferredValue, useState } from "react";
import type { HistoryItem } from "../../shared/contracts";

export type HistoryCopyKind = "zh" | "en" | "all";

interface SidebarProps {
  items: HistoryItem[];
  activeId?: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onCopy: (item: HistoryItem, kind: HistoryCopyKind) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onExportOriginal?: (id: string) => void;
  onClear: () => void;
}

export function Sidebar({ items, activeId, query, onQueryChange, onSelect, onDelete, onCopy, onRename, onExportOriginal, onClear }: SidebarProps) {
  const [contextId, setContextId] = useState<string>();
  const [renameTarget, setRenameTarget] = useState<HistoryItem>();
  const [renameTitle, setRenameTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const filtered = deferredQuery
    ? items.filter((item) => historySearchText(item).includes(deferredQuery))
    : items;
  const normalizedTitle = renameTitle.trim();

  const openRename = (item: HistoryItem) => {
    setRenameTarget(item);
    setRenameTitle(item.title);
  };
  const submitRename = async () => {
    if (!renameTarget || !normalizedTitle) return;
    setRenaming(true);
    try {
      await onRename(renameTarget.id, normalizedTitle);
      setRenameTarget(undefined);
    } catch {
      // The parent reports persistence failures; keep the dialog open for retry.
    } finally {
      setRenaming(false);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-heading"><strong>历史记录</strong><Badge count={items.length} maxCount={50} /></div>
      <Input.Search
        value={query}
        onChange={onQueryChange}
        prefix={<IconSearch />}
        allowClear
        placeholder="搜索历史记录"
        aria-label="搜索历史记录"
      />
      <div className="history-list">
        {filtered.length ? filtered.map((item) => (
          <Dropdown
            key={item.id}
            trigger="contextMenu"
            position="bl"
            onVisibleChange={(visible) => setContextId(visible ? item.id : undefined)}
            droplist={(
              <Menu
                onClickMenuItem={(key) => {
                  if (key === "copy-zh") onCopy(item, "zh");
                  else if (key === "copy-en") onCopy(item, "en");
                  else if (key === "copy-all") onCopy(item, "all");
                  else if (key === "rename") openRename(item);
                  else if (key === "export-original") onExportOriginal?.(item.id);
                }}
              >
                <Menu.Item key="copy-zh" disabled={!historyPrompts(item).zh}><IconCopy />复制中文提示词</Menu.Item>
                <Menu.Item key="copy-en" disabled={!historyPrompts(item).en}><IconCopy />复制英文提示词</Menu.Item>
                <Menu.Item key="copy-all"><IconCopy />复制完整结果</Menu.Item>
                <Menu.Item key="export-original" disabled={!item.originalImage}><IconDownload />导出原图</Menu.Item>
                <Menu.Item key="rename"><IconEdit />修改标题</Menu.Item>
              </Menu>
            )}
          >
            <article
              className={`history-item ${item.id === activeId ? "active" : ""} ${item.id === contextId ? "context-active" : ""}`}
              onClick={() => onSelect(item)}
              onContextMenu={() => setContextId(item.id)}
              tabIndex={0}
              aria-label={`历史任务：${item.title}`}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(item);
                else if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: rect.left + 18, clientY: rect.top + 18 }));
                }
              }}
            >
              <div className="history-thumbnail">
                {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <IconImage />}
              </div>
              <div className="history-copy">
                <strong title={item.title}>{item.title}</strong>
                <span>{formatHistoryTime(item.createdAt)}</span>
                <small className={item.originalImage ? "original-retained" : undefined}>{item.originalImage ? "原图已保留" : "仅保留缩略图"}</small>
              </div>
              <Popconfirm title="删除这条历史记录？" content={item.originalImage ? "关联原图也会被永久删除。" : undefined} okText="删除" cancelText="取消" onOk={() => onDelete(item.id)}>
                <Tooltip content="删除记录">
                  <Button
                    className="history-delete"
                    type="text"
                    shape="circle"
                    status="danger"
                    icon={<IconDelete />}
                    aria-label={`删除 ${item.title}`}
                    onClick={(event) => event.stopPropagation()}
                  />
                </Tooltip>
              </Popconfirm>
            </article>
          </Dropdown>
        )) : (
          <Empty description={items.length ? "没有匹配的记录" : "暂无历史记录"} />
        )}
      </div>
      <Popconfirm title="清空全部历史记录？" content="此操作不可撤销。" okText="清空" cancelText="取消" onOk={onClear} disabled={!items.length}>
        <Button long status="danger" type="text" icon={<IconDelete />} disabled={!items.length}>清空历史记录</Button>
      </Popconfirm>
      <Modal
        title="修改历史标题"
        visible={Boolean(renameTarget)}
        confirmLoading={renaming}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: !normalizedTitle }}
        onOk={() => void submitRename()}
        onCancel={() => { if (!renaming) setRenameTarget(undefined); }}
        unmountOnExit
      >
        <Input
          value={renameTitle}
          maxLength={32}
          showWordLimit
          autoFocus
          aria-label="历史任务标题"
          onChange={setRenameTitle}
          onPressEnter={() => { if (normalizedTitle && !renaming) void submitRename(); }}
        />
      </Modal>
    </aside>
  );
}

function historySearchText(item: HistoryItem): string {
  const prompts = historyPrompts(item);
  return [
    item.title,
    item.inputSummary,
    ...Object.values(item.result.analysis),
    ...Object.values(item.captureMetadata ?? {}),
    prompts.zh,
    prompts.en,
  ].flat().join(" ").toLocaleLowerCase();
}

function historyPrompts(item: HistoryItem) {
  const active = item.result.promptVersions?.find((version) => version.id === item.result.activePromptVersionId);
  return active?.prompts ?? item.result.prompts;
}

function formatHistoryTime(value: string): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
