import { Button, Empty } from "@arco-design/web-react";
import { IconCheckCircle, IconExclamationCircle, IconImage, IconPlayArrow } from "@arco-design/web-react/icon";
import type { BatchProgress, Project, ProjectTask } from "../../shared/contracts";

export function ProjectOverview({ project, tasks, progress, onImport, onStart, onSelect }: { project?: Project; tasks: ProjectTask[]; progress: BatchProgress; onImport: () => void; onStart: () => void; onSelect: (task: ProjectTask) => void }) {
  return (
    <section className="project-overview">
      <header><div><span>当前项目</span><h1>{project?.title ?? "我的项目"}</h1></div><div><Button icon={<IconImage />} onClick={onImport}>导入图片</Button><Button type="primary" icon={<IconPlayArrow />} disabled={!progress.ready && !progress.paused} onClick={onStart}>开始队列</Button></div></header>
      <div className="overview-metrics"><div><strong>{progress.total}</strong><span>全部任务</span></div><div><strong>{progress.ready + progress.queued + progress.paused}</strong><span>待处理</span></div><div><strong>{progress.completed}</strong><span><IconCheckCircle />已完成</span></div><div><strong>{progress.failed}</strong><span><IconExclamationCircle />需要处理</span></div></div>
      <div className="overview-recent"><h2>最近任务</h2>{tasks.length ? tasks.slice(0, 8).map((task) => <button key={task.id} type="button" onClick={() => onSelect(task)}><span className="task-thumbnail">{task.thumbnail ? <img src={task.thumbnail} alt="" /> : <IconImage />}</span><strong>{task.title}</strong><small>{task.status === "completed" ? "已完成" : task.status === "failed" ? "失败" : "待处理"}</small></button>) : <Empty description="导入图片后，任务会安全保存在当前项目" />}</div>
    </section>
  );
}
