import {
  Badge, Button, Checkbox, Drawer, Dropdown, Empty, Input, Menu, Modal, Popconfirm,
  Progress, Radio, Select, Tag, Tooltip,
} from "@arco-design/web-react";
import {
  IconArchive, IconCaretRight, IconDelete, IconDownload, IconDragDotVertical,
  IconEdit, IconFolderAdd, IconHeart, IconImport, IconMore, IconPause, IconPlayArrow,
  IconPlus, IconRefresh, IconSearch, IconStar, IconStop, IconTags,
  IconUp, IconDown, IconSwap,
} from "@arco-design/web-react/icon";
import { useRef, useState } from "react";
import type { BatchProgress, Project, ProjectTask, ReversePreset, TaskFilter, TrashEntry } from "../../shared/contracts";

interface Props {
  projects: Project[];
  activeProjectId?: string;
  tasks: ProjectTask[];
  total: number;
  activeTaskId?: string;
  selectedTaskIds: string[];
  query: string;
  filter: TaskFilter;
  presets: ReversePreset[];
  activePresetId?: string;
  progress: BatchProgress;
  queueRunning: boolean;
  queuePaused: boolean;
  importing: boolean;
  importLabel?: string;
  trash: TrashEntry[];
  onProjectChange: (id: string) => void;
  onCreateProject: (title: string) => Promise<void>;
  onRenameProject: (id: string, title: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: TaskFilter) => void;
  onPresetChange: (id: string) => void;
  onSavePreset: (title: string, snapshot: ReversePreset["snapshot"], id?: string) => Promise<void>;
  onDeletePreset: (id: string) => Promise<void>;
  onImport: (files: File[]) => void;
  onCancelImport: () => void;
  onSelectTask: (task: ProjectTask) => void;
  onSelectionChange: (ids: string[]) => void;
  onFavorite: (task: ProjectTask) => void;
  onTags: (task: ProjectTask, tags: string[]) => Promise<void>;
  onRenameTask?: (task: ProjectTask, title: string) => Promise<void>;
  onRetryTask?: (task: ProjectTask) => Promise<void>;
  onBatchFavorite?: (ids: string[], favorite: boolean) => Promise<void>;
  onBatchTags?: (ids: string[], tags: string[], remove: boolean) => Promise<void>;
  onDuplicate: (task: ProjectTask) => void;
  onDeleteTasks: (ids: string[]) => void;
  onReorder: (ids: string[]) => void;
  onMove: (ids: string[], projectId: string) => void;
  onStartQueue: () => void;
  onPauseQueue: () => void;
  onStopQueue: () => void;
  onRetryFailed: () => void;
  onLoadMore: () => void;
  onExport: (ids: string[]) => void;
  onRestoreTrash: (entry: TrashEntry) => void;
  onDeleteTrash: (entry: TrashEntry) => void;
  onEmptyTrash: () => void;
}

const FILTERS: Array<{ value: TaskFilter; label: string }> = [
  { value: "all", label: "全部" }, { value: "queued", label: "队列中" },
  { value: "completed", label: "已完成" }, { value: "failed", label: "失败" },
  { value: "favorite", label: "收藏" }, { value: "originalRetained", label: "原图已保留" },
];
const PRESET_SELECT_TRIGGER_PROPS = { className: "preset-editor-select-popup", style: { zIndex: 1060 } };

export function ProjectTaskSidebar(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [projectEditor, setProjectEditor] = useState<{ id?: string; title: string }>();
  const [tagEditor, setTagEditor] = useState<ProjectTask>();
  const [tagText, setTagText] = useState("");
  const [taskEditor, setTaskEditor] = useState<ProjectTask>();
  const [taskTitle, setTaskTitle] = useState("");
  const [batchTagEditor, setBatchTagEditor] = useState<"add" | "remove">();
  const [trashOpen, setTrashOpen] = useState(false);
  const [presetEditor, setPresetEditor] = useState<{ id?: string; title: string; snapshot: ReversePreset["snapshot"] }>();
  const selected = new Set(props.selectedTaskIds);
  const project = props.projects.find((item) => item.id === props.activeProjectId);
  const submitProject = async () => {
    if (!projectEditor?.title.trim()) return;
    if (projectEditor.id) await props.onRenameProject(projectEditor.id, projectEditor.title.trim());
    else await props.onCreateProject(projectEditor.title.trim());
    setProjectEditor(undefined);
  };
  const submitTags = async () => {
    if (!tagEditor) return;
    await props.onTags(tagEditor, tagText.split(/[,，]/).map((value) => value.trim()).filter(Boolean));
    setTagEditor(undefined);
  };
  const toggleSelection = (id: string, checked: boolean) => props.onSelectionChange(checked
    ? [...props.selectedTaskIds, id]
    : props.selectedTaskIds.filter((value) => value !== id));

  return (
    <aside className="project-sidebar" aria-label="项目与任务">
      <div className="project-switcher">
        <Select value={props.activeProjectId} onChange={props.onProjectChange} aria-label="当前项目">
          {props.projects.map((item) => <Select.Option key={item.id} value={item.id}>{item.title} · {item.taskCount}</Select.Option>)}
        </Select>
        <Tooltip content="新建项目"><Button shape="circle" icon={<IconFolderAdd />} onClick={() => setProjectEditor({ title: "" })} aria-label="新建项目" /></Tooltip>
        <Dropdown trigger="click" position="br" droplist={<Menu onClickMenuItem={(key) => {
          if (key === "rename" && project) setProjectEditor({ id: project.id, title: project.title });
          if (key === "trash") setTrashOpen(true);
        }}><Menu.Item key="rename"><IconEdit />修改项目名称</Menu.Item><Menu.Item key="trash"><IconArchive />废纸篓</Menu.Item></Menu>}>
          <Button shape="circle" type="text" icon={<IconMore />} aria-label="项目操作" />
        </Dropdown>
      </div>
      <div className="project-search-row">
        <Input value={props.query} onChange={props.onQueryChange} allowClear prefix={<IconSearch />} placeholder="搜索任务、EXIF、提示词" aria-label="搜索任务" />
        <Select className="task-filter" value={props.filter} onChange={props.onFilterChange} aria-label="任务筛选">
          {FILTERS.map((item) => <Select.Option key={item.value} value={item.value}>{item.label}</Select.Option>)}
        </Select>
      </div>
      <div className="preset-row">
        <span>入队预设</span>
        <Select value={props.activePresetId} onChange={props.onPresetChange} aria-label="反推预设">
          {props.presets.map((preset) => <Select.Option key={preset.id} value={preset.id}>{preset.title}</Select.Option>)}
        </Select>
        <Tooltip content="编辑或复制预设"><Button shape="circle" type="text" icon={<IconEdit />} aria-label="编辑预设" onClick={() => { const current = props.presets.find((item) => item.id === props.activePresetId); if (current) setPresetEditor({ id: current.builtIn ? undefined : current.id, title: current.builtIn ? `${current.title} 副本` : current.title, snapshot: { ...current.snapshot } }); }} /></Tooltip>
      </div>
      <div className="queue-summary">
        <div><strong>{props.progress.completed}/{props.progress.total}</strong><span>队列进度</span></div>
        <Progress percent={props.progress.total ? Math.round(props.progress.completed / props.progress.total * 100) : 0} showText={false} size="small" />
        <div className="queue-actions">
          <Button type="primary" icon={props.queueRunning && !props.queuePaused ? <IconPause /> : <IconPlayArrow />} onClick={props.queueRunning && !props.queuePaused ? props.onPauseQueue : props.onStartQueue}>{props.queueRunning && !props.queuePaused ? "暂停队列" : props.queuePaused ? "继续队列" : "开始队列"}</Button>
          {props.queueRunning ? <Tooltip content="停止队列"><Button status="danger" shape="circle" icon={<IconStop />} onClick={props.onStopQueue} aria-label="停止队列" /></Tooltip> : null}
          {props.progress.failed ? <Tooltip content="重试失败项"><Button shape="circle" icon={<IconRefresh />} onClick={props.onRetryFailed} aria-label="重试失败项" /></Tooltip> : null}
        </div>
      </div>
      {props.selectedTaskIds.length ? (
        <div className="batch-toolbar">
          <Checkbox checked={props.selectedTaskIds.length === props.tasks.length} onChange={(checked) => props.onSelectionChange(checked ? props.tasks.map((task) => task.id) : [])}>{props.selectedTaskIds.length} 项</Checkbox>
          <Dropdown trigger="click" droplist={<Menu onClickMenuItem={(key) => props.onMove(props.selectedTaskIds, key)}>{props.projects.filter((item) => item.id !== props.activeProjectId).map((item) => <Menu.Item key={item.id}>{item.title}</Menu.Item>)}</Menu>}><Tooltip content="移动到项目"><Button shape="circle" icon={<IconSwap />} aria-label="移动到项目" /></Tooltip></Dropdown>
          <Dropdown trigger="click" droplist={<Menu onClickMenuItem={(key) => {
            if (key === "favorite") void props.onBatchFavorite?.(props.selectedTaskIds, true);
            if (key === "unfavorite") void props.onBatchFavorite?.(props.selectedTaskIds, false);
            if (key === "tag-add") { setTagText(""); setBatchTagEditor("add"); }
            if (key === "tag-remove") { setTagText(""); setBatchTagEditor("remove"); }
          }}><Menu.Item key="favorite"><IconStar />收藏</Menu.Item><Menu.Item key="unfavorite"><IconHeart />取消收藏</Menu.Item><Menu.Item key="tag-add"><IconTags />添加标签</Menu.Item><Menu.Item key="tag-remove"><IconTags />移除标签</Menu.Item></Menu>}><Tooltip content="批量整理"><Button shape="circle" icon={<IconTags />} aria-label="批量整理" /></Tooltip></Dropdown>
          <Tooltip content="批量导出"><Button shape="circle" icon={<IconDownload />} onClick={() => props.onExport(props.selectedTaskIds)} aria-label="批量导出" /></Tooltip>
          <Popconfirm title={`将 ${props.selectedTaskIds.length} 个任务移入废纸篓？`} onOk={() => props.onDeleteTasks(props.selectedTaskIds)}><Button shape="circle" status="danger" type="text" icon={<IconDelete />} aria-label="批量删除" /></Popconfirm>
        </div>
      ) : null}
      <div className="project-task-list">
        {props.tasks.length ? props.tasks.map((task, taskIndex) => (
          <article key={task.id} className={`project-task ${task.id === props.activeTaskId ? "active" : ""} ${selected.has(task.id) ? "selected" : ""}`} data-status={task.status} aria-label={`项目任务：${task.title}`} onClick={() => props.onSelectTask(task)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") props.onSelectTask(task); }}>
            <Checkbox checked={selected.has(task.id)} onChange={(checked, event) => { event?.stopPropagation(); toggleSelection(task.id, checked); }} aria-label={`选择 ${task.title}`} />
            <div className="task-thumbnail">{task.thumbnail ? <img src={task.thumbnail} alt="" /> : <IconDragDotVertical />}</div>
            <div className="task-copy"><strong title={task.title}>{task.title}</strong><span>{statusLabel(task.status)}{task.errorCode ? ` · ${task.errorCode}` : ""}</span><div>{task.tags.slice(0, 2).map((tag) => <Tag key={tag} size="small">{tag}</Tag>)}{task.originalImage ? <small>原图</small> : null}</div></div>
            <Dropdown trigger="click" position="br" droplist={<Menu onClickMenuItem={(key) => {
              if (key === "favorite") props.onFavorite(task);
              else if (key === "tags") { setTagEditor(task); setTagText(task.tags.join(", ")); }
              else if (key === "rename") { setTaskEditor(task); setTaskTitle(task.title); }
              else if (key === "retry") void props.onRetryTask?.(task);
              else if (key === "duplicate") props.onDuplicate(task);
              else if (key === "export") props.onExport([task.id]);
              else if (key === "move-up" && taskIndex > 0) { const ids = props.tasks.map((item) => item.id); [ids[taskIndex - 1], ids[taskIndex]] = [ids[taskIndex], ids[taskIndex - 1]]; props.onReorder(ids); }
              else if (key === "move-down" && taskIndex < props.tasks.length - 1) { const ids = props.tasks.map((item) => item.id); [ids[taskIndex + 1], ids[taskIndex]] = [ids[taskIndex], ids[taskIndex + 1]]; props.onReorder(ids); }
              else if (key.startsWith("project:")) props.onMove([task.id], key.slice(8));
            }}><Menu.Item key="rename"><IconEdit />重命名任务</Menu.Item><Menu.Item key="retry" disabled={!['failed','blocked','cancelled','paused'].includes(task.status)}><IconRefresh />重试此任务</Menu.Item><Menu.Item key="favorite">{task.favorite ? <IconHeart /> : <IconStar />}{task.favorite ? "取消收藏" : "收藏"}</Menu.Item><Menu.Item key="tags"><IconTags />编辑标签</Menu.Item><Menu.Item key="move-up" disabled={taskIndex === 0}><IconUp />上移</Menu.Item><Menu.Item key="move-down" disabled={taskIndex === props.tasks.length - 1}><IconDown />下移</Menu.Item><Menu.SubMenu key="move-project" title={<span><IconSwap />移动到项目</span>}>{props.projects.filter((projectItem) => projectItem.id !== task.projectId).map((projectItem) => <Menu.Item key={`project:${projectItem.id}`}>{projectItem.title}</Menu.Item>)}</Menu.SubMenu><Menu.Item key="duplicate"><IconPlus />重新生成副本</Menu.Item><Menu.Item key="export" disabled={task.status !== "completed"}><IconDownload />导出任务</Menu.Item></Menu>}>
              <Button className="task-more" shape="circle" type="text" icon={<IconMore />} aria-label={`${task.title} 操作`} onClick={(event) => event.stopPropagation()} />
            </Dropdown>
          </article>
        )) : <Empty description="当前项目暂无任务" />}
        {props.tasks.length < props.total ? <Button long type="text" icon={<IconCaretRight />} onClick={props.onLoadMore}>加载更多</Button> : null}
      </div>
      <div className="project-import">
        <input ref={inputRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) props.onImport(files); }} />
        <Button long type={props.importing ? "outline" : "primary"} status={props.importing ? "danger" : undefined} icon={props.importing ? <IconStop /> : <IconImport />} onClick={props.importing ? props.onCancelImport : () => inputRef.current?.click()}>{props.importing ? props.importLabel ?? "取消导入" : "导入图片"}</Button>
      </div>
      <Modal title={projectEditor?.id ? "修改项目名称" : "新建项目"} visible={Boolean(projectEditor)} onCancel={() => setProjectEditor(undefined)} onOk={() => void submitProject()} okButtonProps={{ disabled: !projectEditor?.title.trim() }}>
        <Input value={projectEditor?.title ?? ""} maxLength={64} showWordLimit autoFocus onChange={(title) => setProjectEditor((value) => value ? { ...value, title } : value)} onPressEnter={() => void submitProject()} />
        {projectEditor?.id ? <Popconfirm title="将项目及任务移入废纸篓？" onOk={() => props.onDeleteProject(projectEditor.id!)}><Button className="project-delete-action" status="danger" type="text" icon={<IconDelete />}>删除项目</Button></Popconfirm> : null}
      </Modal>
      <Modal title="编辑任务标签" visible={Boolean(tagEditor)} onCancel={() => setTagEditor(undefined)} onOk={() => void submitTags()}><Input value={tagText} onChange={setTagText} placeholder="使用逗号分隔，最多 12 个" maxLength={300} /></Modal>
      <Modal title="重命名任务" visible={Boolean(taskEditor)} onCancel={() => setTaskEditor(undefined)} onOk={async () => { if (!taskEditor || !taskTitle.trim() || !props.onRenameTask) return; await props.onRenameTask(taskEditor, taskTitle.trim()); setTaskEditor(undefined); }} okButtonProps={{ disabled: !taskTitle.trim() }}><Input value={taskTitle} maxLength={64} showWordLimit autoFocus onChange={setTaskTitle} /></Modal>
      <Modal title={batchTagEditor === "remove" ? "批量移除标签" : "批量添加标签"} visible={Boolean(batchTagEditor)} onCancel={() => setBatchTagEditor(undefined)} onOk={async () => { if (!batchTagEditor || !props.onBatchTags) return; const tags = tagText.split(/[,，]/).map((value) => value.trim()).filter(Boolean); await props.onBatchTags(props.selectedTaskIds, tags, batchTagEditor === "remove"); setBatchTagEditor(undefined); }} okButtonProps={{ disabled: !tagText.trim() }}><Input value={tagText} onChange={setTagText} placeholder="使用逗号分隔标签" maxLength={300} /></Modal>
      <Modal className="preset-editor-modal" title={presetEditor?.id ? "编辑预设" : "复制为自定义预设"} visible={Boolean(presetEditor)} onCancel={() => setPresetEditor(undefined)} onOk={async () => { if (!presetEditor) return; await props.onSavePreset(presetEditor.title, presetEditor.snapshot, presetEditor.id); setPresetEditor(undefined); }} okButtonProps={{ disabled: !presetEditor?.title.trim() }}>
        <Input value={presetEditor?.title ?? ""} maxLength={64} placeholder="预设名称" onChange={(title) => setPresetEditor((value) => value ? { ...value, title } : value)} />
        <Input.TextArea className="preset-requirements" value={presetEditor?.snapshot.requirements ?? ""} maxLength={2000} placeholder="补充要求" autoSize={{ minRows: 3, maxRows: 6 }} onChange={(requirements) => setPresetEditor((value) => value ? { ...value, snapshot: { ...value.snapshot, requirements } } : value)} />
        <label className="preset-editor-field"><span>输出语言</span><Radio.Group type="button" value={presetEditor?.snapshot.outputLanguage} onChange={(outputLanguage) => setPresetEditor((value) => value ? { ...value, snapshot: { ...value.snapshot, outputLanguage } } : value)}><Radio value="chinese">中文</Radio><Radio value="english">英文</Radio><Radio value="bilingual">双语</Radio></Radio.Group></label>
        <label className="preset-editor-field"><span>详细程度</span><Select aria-label="详细程度" triggerProps={PRESET_SELECT_TRIGGER_PROPS} value={presetEditor?.snapshot.detailLevel} options={[{ label: "精简", value: "concise" }, { label: "标准", value: "standard" }, { label: "详细", value: "detailed" }, { label: "专家", value: "expert" }]} onChange={(detailLevel) => setPresetEditor((value) => value ? { ...value, snapshot: { ...value.snapshot, detailLevel } } : value)} /></label>
        <label className="preset-editor-field"><span>自动优化</span><Select aria-label="自动优化" triggerProps={PRESET_SELECT_TRIGGER_PROPS} allowClear placeholder="不自动优化" value={presetEditor?.snapshot.autoOptimizeTarget} options={[{ label: "通用", value: "general" }, { label: "Midjourney", value: "midjourney" }, { label: "Flux", value: "flux" }, { label: "SDXL", value: "sdxl" }]} onChange={(autoOptimizeTarget) => setPresetEditor((value) => value ? { ...value, snapshot: { ...value.snapshot, autoOptimizeTarget } } : value)} /></label>
        {presetEditor?.snapshot.autoOptimizeTarget ? <Input.TextArea className="preset-requirements" value={presetEditor.snapshot.autoOptimizeRequirements} maxLength={500} showWordLimit placeholder="自动优化附加要求" autoSize={{ minRows: 2, maxRows: 4 }} onChange={(autoOptimizeRequirements) => setPresetEditor((value) => value ? { ...value, snapshot: { ...value.snapshot, autoOptimizeRequirements } } : value)} /> : null}
        {presetEditor?.id ? <Popconfirm title="删除这个自定义预设？" onOk={async () => { await props.onDeletePreset(presetEditor.id!); setPresetEditor(undefined); }}><Button className="project-delete-action" status="danger" type="text" icon={<IconDelete />}>删除预设</Button></Popconfirm> : null}
      </Modal>
      <Drawer title={<span>废纸篓 <Badge count={props.trash.length} /></span>} visible={trashOpen} width={380} onCancel={() => setTrashOpen(false)} footer={<Popconfirm title="永久清空废纸篓？" onOk={props.onEmptyTrash}><Button long status="danger" disabled={!props.trash.length}>清空废纸篓</Button></Popconfirm>}>
        <div className="trash-list">{props.trash.length ? props.trash.map((entry) => <div key={`${entry.kind}-${entry.id}`} className="trash-entry"><div><strong>{entry.title}</strong><span>{entry.kind === "project" ? "项目" : "任务"} · {new Date(entry.purgeAt).toLocaleDateString("zh-CN")} 自动清理</span></div><Button size="mini" onClick={() => props.onRestoreTrash(entry)}>恢复</Button><Popconfirm title="立即永久删除？" onOk={() => props.onDeleteTrash(entry)}><Button size="mini" status="danger" type="text">删除</Button></Popconfirm></div>) : <Empty description="废纸篓为空" />}</div>
      </Drawer>
    </aside>
  );
}

function statusLabel(status: ProjectTask["status"]): string {
  return ({ ready: "待处理", queued: "队列中", preparing: "准备图片", running: "分析中", completed: "已完成", failed: "失败", paused: "已暂停", cancelled: "已停止", blocked: "需要处理" })[status];
}
