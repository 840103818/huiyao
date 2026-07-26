import { Button, Empty } from "@arco-design/web-react";
import { IconCheckCircle, IconExclamationCircle, IconImage, IconImport, IconPlayArrow } from "@arco-design/web-react/icon";
import { useState } from "react";
import type { BatchProgress, Project, ProjectTask } from "../../shared/contracts";

interface ProjectOverviewProps {
  project?: Project;
  tasks: ProjectTask[];
  progress: BatchProgress;
  onImport: () => void;
  onImportFiles: (files: File[]) => void;
  onStart: () => void;
  onSelect: (task: ProjectTask) => void;
}

export function ProjectOverview({ project, tasks, progress, onImport, onImportFiles, onStart, onSelect }: ProjectOverviewProps) {
  const [dragging, setDragging] = useState(false);
  const pending = progress.ready + progress.queued + progress.paused;

  return (
    <section
      className={`project-overview ${dragging ? "is-dragging" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onImportFiles(files);
      }}
    >
      <div className="overview-content">
        <header className="overview-header">
          <div><span>当前项目</span><h1>{project?.title ?? "我的项目"}</h1><p>{progress.total ? `${progress.total} 个任务，${pending} 个等待处理` : "本地图片创作工作区"}</p></div>
          <div><Button icon={<IconImport />} onClick={onImport}>导入图片</Button><Button type="primary" icon={<IconPlayArrow />} disabled={!progress.ready && !progress.paused} onClick={onStart}>开始队列</Button></div>
        </header>
        <div className="overview-metrics" aria-label="项目任务概况">
          <div><strong>{progress.total}</strong><span>全部任务</span></div>
          <div><strong>{pending}</strong><span>待处理</span></div>
          <div><strong>{progress.completed}</strong><span><IconCheckCircle />已完成</span></div>
          <div className={progress.failed ? "has-error" : ""}><strong>{progress.failed}</strong><span><IconExclamationCircle />需要处理</span></div>
        </div>
        <section className="overview-recent">
          <header><div><h2>最近任务</h2><span>{Math.min(tasks.length, 8)} 项</span></div></header>
          {tasks.length ? tasks.slice(0, 8).map((task) => (
            <button key={task.id} type="button" onClick={() => onSelect(task)}>
              <span className="task-thumbnail">{task.thumbnail ? <img src={task.thumbnail} alt="" /> : <IconImage />}</span>
              <span><strong>{task.title}</strong><small>{task.fileName}</small></span>
              <em data-status={task.status}>{task.status === "completed" ? "已完成" : task.status === "failed" ? "失败" : "待处理"}</em>
            </button>
          )) : (
            <div className="overview-empty"><Empty description="当前项目还没有任务" /><Button type="primary" icon={<IconImport />} onClick={onImport}>导入第一张图片</Button></div>
          )}
        </section>
      </div>
      {dragging ? <div className="overview-drop-overlay"><IconImport /><strong>松开以导入到当前项目</strong><span>支持 PNG、JPEG 和 WebP</span></div> : null}
    </section>
  );
}
