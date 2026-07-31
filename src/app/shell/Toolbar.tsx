import { Button, Tooltip } from "@arco-design/web-react";
import { IconList, IconMenuFold, IconMenuUnfold, IconSettings, IconStop } from "@arco-design/web-react/icon";
import type { GenerationState } from "../../shared/contracts";
import { isDesktopApp } from "../../infrastructure/tauri";
import brandMark from "../../assets/huiyao-mark.png";
import packageMetadata from "../../../package.json";

export type AppView = "workspace" | "settings" | "logs";

interface ToolbarProps {
  sidebarCollapsed: boolean;
  compactHistory: boolean;
  view: AppView;
  generationState: GenerationState;
  elapsedMs: number;
  disabled?: boolean;
  projectTitle?: string;
  taskTitle?: string;
  onToggleSidebar: () => void;
  onNavigate: (view: AppView) => void;
  onStop?: () => void;
}

export function Toolbar({
  sidebarCollapsed,
  compactHistory,
  view,
  generationState,
  elapsedMs,
  disabled,
  projectTitle,
  taskTitle,
  onToggleSidebar,
  onNavigate,
  onStop,
}: ToolbarProps) {
  const workspaceOpen = view === "workspace";
  const historyLabel = compactHistory ? "打开历史记录" : sidebarCollapsed ? "展开历史记录" : "收起历史记录";

  return (
    <header className="toolbar" data-tauri-drag-region>
      <div className="toolbar-leading" data-tauri-drag-region>
        {!isDesktopApp() ? (
          <div className="traffic-lights" aria-hidden="true"><i /><i /><i /></div>
        ) : null}
        {workspaceOpen ? (
          <ToolbarButton label={historyLabel} disabled={disabled} onClick={onToggleSidebar}>
            {compactHistory || sidebarCollapsed ? <IconMenuUnfold /> : <IconMenuFold />}
          </ToolbarButton>
        ) : (
          <ToolbarButton label="返回工作台" disabled={disabled} onClick={() => onNavigate("workspace")}>
            <IconMenuUnfold />
          </ToolbarButton>
        )}
        <span className="toolbar-separator" aria-hidden="true" />
        <div className="wordmark" data-tauri-drag-region>
          <img src={brandMark} alt="" />
          <strong>绘钥</strong>
          <span>v{packageMetadata.version}</span>
        </div>
      </div>

      {workspaceOpen ? (
        <div className="workspace-location" data-state={generationState} data-tauri-drag-region>
          <span>{projectTitle ?? "我的项目"}</span><b>/</b><strong>{taskTitle ?? "项目概览"}</strong>
          {generationState !== "idle" ? (
            <span className="workspace-run-state">
              <i />
              <em>{toolbarState(generationState)}</em>
              {isActiveState(generationState) ? <time>{(elapsedMs / 1000).toFixed(1)} 秒</time> : null}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="toolbar-title" data-tauri-drag-region>{view === "settings" ? "系统设置" : "系统运行日志"}</div>
      )}

      <div className="toolbar-actions">
        {disabled && onStop ? (
          <Button className="toolbar-stop" size="small" status="danger" icon={<IconStop />} loading={generationState === "stopping"} onClick={onStop}>
            {generationState === "stopping" ? "正在停止" : "停止生成"}
          </Button>
        ) : null}
        <ToolbarButton label="运行日志" selected={view === "logs"} disabled={disabled} onClick={() => onNavigate("logs")}>
          <IconList />
        </ToolbarButton>
        <ToolbarButton label="设置" selected={view === "settings"} disabled={disabled} onClick={() => onNavigate("settings")}>
          <IconSettings />
        </ToolbarButton>
      </div>
    </header>
  );
}

function isActiveState(state: GenerationState): boolean {
  return ["connecting", "streaming", "fallback", "stopping"].includes(state);
}

function ToolbarButton({ label, selected, disabled, onClick, children }: { label: string; selected?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={label} position="bottom">
      <Button className={selected ? "selected" : undefined} type="text" shape="circle" icon={children} disabled={disabled} onClick={onClick} aria-label={label} />
    </Tooltip>
  );
}

function toolbarState(state: GenerationState): string {
  if (state === "connecting") return "连接模型";
  if (state === "streaming") return "流式解析";
  if (state === "fallback") return "兼容解析";
  if (state === "stopping") return "停止中";
  if (state === "cancelled") return "已停止";
  if (state === "complete") return "解析完成";
  return "图片反推";
}
