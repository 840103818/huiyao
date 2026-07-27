import { invoke } from "@tauri-apps/api/core";
import type {
  BatchExportRequest, BatchProgress, ImportProjectTaskInput, Project, ProjectTask,
  ProjectTaskPage, ReversePreset, ReversePresetSnapshot, TaskFilter, TaskStatus, TrashEntry,
} from "../../shared/contracts";
import { desktopOnlyError, isDesktopApp } from "./core";

const desktop = <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isDesktopApp()) return Promise.reject(desktopOnlyError("项目工作区仅在 macOS 桌面应用中可用"));
  return invoke<T>(command, args);
};

export const listProjects = () => desktop<Project[]>("list_projects");
export const createProject = (title: string) => desktop<Project>("create_project", { title });
export const renameProject = (projectId: string, title: string) => desktop<void>("rename_project", { projectId, title });
export const deleteProject = (projectId: string) => desktop<void>("delete_project", { projectId });
export const listProjectTasks = (projectId: string, filter: TaskFilter, query: string, offset = 0, limit = 50) => desktop<ProjectTaskPage>("list_project_tasks", { projectId, filter, query, offset, limit });
export const getProjectTask = (taskId: string) => desktop<ProjectTask>("get_project_task", { taskId });
export const renameProjectTask = (taskId: string, title: string) => desktop<void>("rename_project_task", { taskId, title });
export const importProjectTask = (input: ImportProjectTaskInput) => desktop<ProjectTask>("import_project_task", { input });
export const updateProjectTaskStatus = (taskIds: string[], status: TaskStatus) => desktop<number>("update_project_task_status", { taskIds, status });
export const completeProjectTask = (taskId: string, result: ProjectTask["result"]) => desktop<void>("complete_project_task", { input: { taskId, result } });
export const updateProjectTaskResult = (taskId: string, result: ProjectTask["result"]) => desktop<void>("update_project_task_result", { input: { taskId, result } });
export const failProjectTask = (taskId: string, code: string, message: string) => desktop<void>("fail_project_task", { input: { taskId, code, message } });
export const setProjectTaskFavorite = (taskId: string, favorite: boolean) => desktop<void>("set_project_task_favorite", { taskId, favorite });
export const setProjectTaskTags = (taskId: string, tags: string[]) => desktop<void>("set_project_task_tags", { taskId, tags });
export const setProjectTasksFavorite = (taskIds: string[], favorite: boolean) => desktop<number>("set_project_tasks_favorite", { taskIds, favorite });
export const updateProjectTasksTags = (taskIds: string[], tags: string[], remove = false) => desktop<number>("update_project_tasks_tags", { taskIds, tags, remove });
export const moveProjectTasks = (taskIds: string[], projectId: string) => desktop<number>("move_project_tasks", { taskIds, projectId });
export const reorderProjectTasks = (taskIds: string[]) => desktop<void>("reorder_project_tasks", { taskIds });
export const duplicateProjectTask = (taskId: string) => desktop<ProjectTask>("duplicate_project_task", { taskId });
export const deleteProjectTasks = (taskIds: string[]) => desktop<number>("delete_project_tasks", { taskIds });
export const getBatchProgress = (projectId: string) => desktop<BatchProgress>("get_batch_progress", { projectId });
export const listReversePresets = () => desktop<ReversePreset[]>("list_reverse_presets");
export const saveReversePreset = (title: string, snapshot: ReversePresetSnapshot, presetId?: string) => desktop<ReversePreset>("save_reverse_preset", { title, snapshot, presetId });
export const deleteReversePreset = (presetId: string) => desktop<void>("delete_reverse_preset", { presetId });
export const listTrash = () => desktop<TrashEntry[]>("list_trash");
export const restoreTrashEntry = (entryId: string, kind: TrashEntry["kind"]) => desktop<void>("restore_trash_entry", { entryId, kind });
export const permanentlyDeleteTrashEntry = (entryId: string, kind: TrashEntry["kind"]) => desktop<void>("permanently_delete_trash_entry", { entryId, kind });
export const emptyTrash = () => desktop<number>("empty_trash");
export const loadWorkspaceOriginalImage = async (taskId: string): Promise<Uint8Array> => {
  const response = await desktop<ArrayBuffer | Uint8Array>("load_workspace_original_image", { taskId });
  return response instanceof Uint8Array ? response : new Uint8Array(response);
};
export const exportWorkspaceOriginalImage = (taskId: string) => desktop<boolean>("export_workspace_original_image", { taskId });
export const exportProjectTasks = (request: BatchExportRequest) => desktop<boolean>("export_project_tasks", { request });
export const saveWorkspaceSession = (lastProjectId?: string, lastTaskId?: string) => desktop<void>("save_workspace_session", { session: { lastProjectId, lastTaskId } });
