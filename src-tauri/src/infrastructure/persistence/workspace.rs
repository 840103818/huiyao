use std::{fs, path::Path};

use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{de::DeserializeOwned, Serialize};
use uuid::Uuid;

use crate::models::{
    BatchProgress, CommandError, HistoryItem, OriginalImageInfo, Project, ProjectTask,
    ProjectTaskPage, ReversePreset, ReversePresetSnapshot, ReverseResult, TaskFilter, TaskStatus,
    TrashEntry,
};

const DEFAULT_PROJECT_ID: &str = "project-default";
const HISTORY_PROJECT_ID: &str = "project-history";
const PAGE_LIMIT: u64 = 50;
const MAX_QUERY_CHARS: usize = 500;
const MAX_FILE_NAME_CHARS: usize = 255;
const MAX_REQUIREMENTS_CHARS: usize = 2_000;
const MAX_OPTIMIZATION_REQUIREMENTS_CHARS: usize = 500;
const MAX_RESULT_BYTES: usize = 2 * 1024 * 1024;

fn db_error(_error: impl ToString) -> CommandError {
    CommandError::new("workspace_database", "本地工作区数据库操作失败")
}

fn open(path: &Path) -> Result<Connection, CommandError> {
    let connection = Connection::open(path).map_err(db_error)?;
    connection
        .execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;")
        .map_err(db_error)?;
    crate::store::set_private_file_permissions(path, "workspace_database")?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = std::path::PathBuf::from(format!("{}{suffix}", path.display()));
        if sidecar.exists() {
            crate::store::set_private_file_permissions(&sidecar, "workspace_database")?;
        }
    }
    Ok(connection)
}

fn create_schema(connection: &Connection) -> Result<(), CommandError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS projects (
           id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL, deleted_at TEXT
         );
         CREATE TABLE IF NOT EXISTS tasks (
           id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
           title TEXT NOT NULL, file_name TEXT NOT NULL, thumbnail TEXT,
           image_info_json TEXT, original_image_json TEXT, original_asset_id TEXT,
           capture_metadata_json TEXT, status TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0,
           preset_snapshot_json TEXT, result_json TEXT, error_code TEXT, error_message TEXT,
           parent_task_id TEXT, queue_position INTEGER NOT NULL, created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL, deleted_at TEXT
         );
         CREATE INDEX IF NOT EXISTS tasks_project_page ON tasks(project_id, deleted_at, queue_position, created_at DESC);
         CREATE INDEX IF NOT EXISTS tasks_status ON tasks(project_id, status, deleted_at);
         CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
         CREATE TABLE IF NOT EXISTS task_tags (
           task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
           tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
           PRIMARY KEY(task_id, tag_id)
         );
         CREATE TABLE IF NOT EXISTS presets (
           id TEXT PRIMARY KEY, title TEXT NOT NULL, built_in INTEGER NOT NULL,
           snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
           deleted_at TEXT
         );
         PRAGMA user_version=1;",
    ).map_err(db_error)
}

pub fn initialize(path: &Path, history: &[HistoryItem]) -> Result<(), CommandError> {
    if path.exists() {
        let connection = open(path)?;
        create_schema(&connection)?;
        ensure_defaults(&connection, history)?;
        return Ok(());
    }
    let temp = path.with_extension("sqlite3.tmp");
    if temp.exists() {
        fs::remove_file(&temp).map_err(db_error)?;
    }
    {
        let connection = Connection::open(&temp).map_err(db_error)?;
        connection
            .execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;")
            .map_err(db_error)?;
        create_schema(&connection)?;
        ensure_defaults(&connection, history)?;
        connection
            .execute_batch("PRAGMA integrity_check;")
            .map_err(db_error)?;
    }
    fs::rename(&temp, path).map_err(db_error)?;
    crate::store::set_private_file_permissions(path, "workspace_database")?;
    let _ = open(path)?;
    Ok(())
}

fn ensure_defaults(connection: &Connection, history: &[HistoryItem]) -> Result<(), CommandError> {
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "INSERT OR IGNORE INTO projects(id,title,created_at,updated_at) VALUES(?1,'我的项目',?2,?2)",
        params![DEFAULT_PROJECT_ID, now],
    ).map_err(db_error)?;
    if !history.is_empty() {
        connection.execute(
            "INSERT OR IGNORE INTO projects(id,title,created_at,updated_at) VALUES(?1,'历史记录',?2,?2)",
            params![HISTORY_PROJECT_ID, now],
        ).map_err(db_error)?;
        let migrated = connection
            .query_row(
                "SELECT value FROM schema_meta WHERE key='history_migrated'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(db_error)?
            .is_some();
        if !migrated {
            for (index, item) in history.iter().enumerate() {
                insert_history(connection, item, index as i64)?;
            }
            connection
                .execute(
                    "INSERT OR REPLACE INTO schema_meta(key,value) VALUES('history_migrated',?1)",
                    params![now],
                )
                .map_err(db_error)?;
        }
    }
    seed_presets(connection)
}

fn insert_history(
    connection: &Connection,
    item: &HistoryItem,
    position: i64,
) -> Result<(), CommandError> {
    connection.execute(
        "INSERT OR IGNORE INTO tasks(id,project_id,title,file_name,thumbnail,image_info_json,original_image_json,original_asset_id,capture_metadata_json,status,favorite,preset_snapshot_json,result_json,queue_position,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'completed',0,NULL,?10,?11,?12,?12)",
        params![item.id, HISTORY_PROJECT_ID, item.title, item.input_summary, item.thumbnail,
            json_opt(&item.image_info)?, json_opt(&item.original_image)?, item.original_image.as_ref().map(|_| item.id.clone()),
            json_opt(&item.capture_metadata)?, json(&item.result)?, position, item.created_at],
    ).map_err(db_error)?;
    Ok(())
}

fn seed_presets(connection: &Connection) -> Result<(), CommandError> {
    let now = Utc::now().to_rfc3339();
    let presets = [
        ("preset-standard", "标准反推", ""),
        (
            "preset-product",
            "商业产品",
            "突出产品材质、光型、商业布景和可复现的棚拍参数",
        ),
        (
            "preset-portrait",
            "人物摄影",
            "重点分析人物姿态、肤色、布光、镜头压缩感和后期质感",
        ),
        (
            "preset-illustration",
            "插画风格",
            "重点提炼画风、笔触、色彩关系、构图节奏和媒介特征",
        ),
    ];
    for (id, title, requirements) in presets {
        let snapshot = ReversePresetSnapshot {
            requirements: requirements.into(),
            ..Default::default()
        };
        connection.execute(
            "INSERT OR IGNORE INTO presets(id,title,built_in,snapshot_json,created_at,updated_at) VALUES(?1,?2,1,?3,?4,?4)",
            params![id, title, json(&snapshot)?, now],
        ).map_err(db_error)?;
    }
    Ok(())
}

pub fn list_projects(path: &Path) -> Result<Vec<Project>, CommandError> {
    let connection = open(path)?;
    let mut statement = connection
        .prepare(
            "SELECT p.id,p.title,p.created_at,p.updated_at,
         COUNT(t.id),COALESCE(SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END),0)
         FROM projects p LEFT JOIN tasks t ON t.project_id=p.id AND t.deleted_at IS NULL
         WHERE p.deleted_at IS NULL GROUP BY p.id ORDER BY p.updated_at DESC",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                task_count: row.get(4)?,
                completed_count: row.get(5)?,
            })
        })
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

pub fn create_project(path: &Path, title: &str) -> Result<Project, CommandError> {
    let title = validate_title(title, "项目名称")?;
    let connection = open(path)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO projects(id,title,created_at,updated_at) VALUES(?1,?2,?3,?3)",
            params![id, title, now],
        )
        .map_err(db_error)?;
    Ok(Project {
        id,
        title,
        task_count: 0,
        completed_count: 0,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn rename_project(path: &Path, id: &str, title: &str) -> Result<(), CommandError> {
    let title = validate_title(title, "项目名称")?;
    let changed = open(path)?
        .execute(
            "UPDATE projects SET title=?2,updated_at=?3 WHERE id=?1 AND deleted_at IS NULL",
            params![id, title, Utc::now().to_rfc3339()],
        )
        .map_err(db_error)?;
    if changed == 0 {
        return Err(CommandError::new("project_missing", "项目不存在"));
    }
    Ok(())
}

pub fn list_tasks(
    path: &Path,
    project_id: &str,
    filter: TaskFilter,
    query: &str,
    offset: u64,
    limit: u64,
) -> Result<ProjectTaskPage, CommandError> {
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(CommandError::new(
            "task_query_invalid",
            "任务搜索内容最多 500 个字符",
        ));
    }
    let connection = open(path)?;
    let limit = limit.clamp(1, PAGE_LIMIT);
    let pattern = format!("%{}%", query.trim().replace(['%', '_'], ""));
    let filter_sql = match filter {
        TaskFilter::All => "1=1",
        TaskFilter::Queued => "t.status IN ('ready','queued','preparing','running','paused')",
        TaskFilter::Completed => "t.status='completed'",
        TaskFilter::Failed => "t.status IN ('failed','blocked')",
        TaskFilter::Favorite => "t.favorite=1",
        TaskFilter::OriginalRetained => "t.original_image_json IS NOT NULL",
    };
    let where_sql = format!("t.project_id=?1 AND t.deleted_at IS NULL AND {filter_sql} AND (?2='%%' OR t.title LIKE ?2 OR t.file_name LIKE ?2 OR COALESCE(t.result_json,'') LIKE ?2 OR COALESCE(t.capture_metadata_json,'') LIKE ?2 OR EXISTS(SELECT 1 FROM task_tags tt JOIN tags g ON g.id=tt.tag_id WHERE tt.task_id=t.id AND g.name LIKE ?2))");
    let total: u64 = connection
        .query_row(
            &format!("SELECT COUNT(*) FROM tasks t WHERE {where_sql}"),
            params![project_id, pattern],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    let sql = format!("SELECT t.id,t.project_id,t.title,t.file_name,t.thumbnail,t.image_info_json,t.original_image_json,t.capture_metadata_json,t.status,t.favorite,t.preset_snapshot_json,NULL,t.error_code,t.error_message,t.parent_task_id,t.queue_position,t.created_at,t.updated_at FROM tasks t WHERE {where_sql} ORDER BY t.queue_position ASC,t.created_at DESC LIMIT ?3 OFFSET ?4");
    let mut statement = connection.prepare(&sql).map_err(db_error)?;
    let rows = statement
        .query_map(params![project_id, pattern, limit, offset], task_from_row)
        .map_err(db_error)?;
    let mut items = rows.collect::<Result<Vec<_>, _>>().map_err(db_error)?;
    for item in &mut items {
        item.tags = task_tags(&connection, &item.id)?;
    }
    Ok(ProjectTaskPage {
        items,
        total,
        offset,
        limit,
    })
}

pub fn get_task(path: &Path, task_id: &str) -> Result<ProjectTask, CommandError> {
    let connection = open(path)?;
    let mut task = connection.query_row(
        "SELECT id,project_id,title,file_name,thumbnail,image_info_json,original_image_json,capture_metadata_json,status,favorite,preset_snapshot_json,result_json,error_code,error_message,parent_task_id,queue_position,created_at,updated_at FROM tasks WHERE id=?1 AND deleted_at IS NULL",
        params![task_id], task_from_row,
    ).optional().map_err(db_error)?.ok_or_else(|| CommandError::new("task_missing", "任务不存在"))?;
    task.tags = task_tags(&connection, task_id)?;
    Ok(task)
}

pub fn task_original(
    path: &Path,
    task_id: &str,
) -> Result<(String, OriginalImageInfo), CommandError> {
    let connection = open(path)?;
    connection.query_row(
        "SELECT original_asset_id,original_image_json FROM tasks WHERE id=?1 AND deleted_at IS NULL AND original_image_json IS NOT NULL",
        params![task_id], |row| {
            let asset: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((asset, value))
        },
    ).optional().map_err(db_error)?
        .ok_or_else(|| CommandError::new("original_missing", "该任务未保留原图"))
        .and_then(|(asset, value)| Ok((asset, parse(&value)?)))
}

pub fn insert_task(
    path: &Path,
    task: &ProjectTask,
    original_asset_id: Option<&str>,
) -> Result<(), CommandError> {
    validate_task(task)?;
    let connection = open(path)?;
    connection.execute(
        "INSERT INTO tasks(id,project_id,title,file_name,thumbnail,image_info_json,original_image_json,original_asset_id,capture_metadata_json,status,favorite,preset_snapshot_json,result_json,error_code,error_message,parent_task_id,queue_position,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
        params![task.id,task.project_id,task.title,task.file_name,task.thumbnail,json_opt(&task.image_info)?,json_opt(&task.original_image)?,original_asset_id,
            json_opt(&task.capture_metadata)?,task.status.as_str(),task.favorite,json_opt(&task.preset_snapshot)?,json_opt(&task.result)?,task.error_code,task.error_message,
            task.parent_task_id,task.queue_position,task.created_at,task.updated_at],
    ).map_err(db_error)?;
    Ok(())
}

pub fn next_queue_position(path: &Path, project_id: &str) -> Result<i64, CommandError> {
    open(path)?
        .query_row(
            "SELECT COALESCE(MAX(queue_position),-1)+1 FROM tasks WHERE project_id=?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(db_error)
}

pub fn update_task_status(
    path: &Path,
    ids: &[String],
    status: TaskStatus,
) -> Result<usize, CommandError> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut connection = open(path)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let now = Utc::now().to_rfc3339();
    let mut count = 0;
    for id in ids {
        let current: Option<String> = transaction
            .query_row(
                "SELECT status FROM tasks WHERE id=?1 AND deleted_at IS NULL",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;
        if let Some(current) = current.as_deref() {
            if !can_transition(current, status) {
                return Err(CommandError::new(
                    "task_status_invalid",
                    format!("任务状态不能从 {current} 变更为 {}", status.as_str()),
                ));
            }
        }
        count += transaction.execute("UPDATE tasks SET status=?2,error_code=NULL,error_message=NULL,updated_at=?3 WHERE id=?1 AND deleted_at IS NULL", params![id,status.as_str(),now]).map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)?;
    Ok(count)
}

pub fn complete_task(
    path: &Path,
    task_id: &str,
    result: &ReverseResult,
) -> Result<(), CommandError> {
    let result_json = bounded_json(
        result,
        MAX_RESULT_BYTES,
        "task_result_too_large",
        "任务结果超过 2 MiB 限制",
    )?;
    let mut connection = open(path)?;
    let transaction = connection.transaction().map_err(db_error)?;
    ensure_task_transition(&transaction, task_id, TaskStatus::Completed)?;
    let changed = transaction.execute("UPDATE tasks SET status='completed',result_json=?2,error_code=NULL,error_message=NULL,updated_at=?3 WHERE id=?1 AND deleted_at IS NULL", params![task_id,result_json,Utc::now().to_rfc3339()]).map_err(db_error)?;
    if changed == 0 {
        return Err(CommandError::new("task_missing", "任务不存在"));
    }
    transaction.commit().map_err(db_error)?;
    Ok(())
}

pub fn update_task_result(
    path: &Path,
    task_id: &str,
    result: &ReverseResult,
) -> Result<(), CommandError> {
    let result_json = bounded_json(
        result,
        MAX_RESULT_BYTES,
        "task_result_too_large",
        "任务结果超过 2 MiB 限制",
    )?;
    let changed = open(path)?
        .execute(
            "UPDATE tasks SET result_json=?2,updated_at=?3 WHERE id=?1 AND status='completed' AND deleted_at IS NULL",
            params![task_id, result_json, Utc::now().to_rfc3339()],
        )
        .map_err(db_error)?;
    if changed == 0 {
        return Err(CommandError::new(
            "task_status_invalid",
            "只有已完成任务可以更新提示词结果",
        ));
    }
    Ok(())
}

pub fn fail_task(
    path: &Path,
    task_id: &str,
    code: &str,
    message: &str,
) -> Result<(), CommandError> {
    let mut connection = open(path)?;
    let transaction = connection.transaction().map_err(db_error)?;
    ensure_task_transition(&transaction, task_id, TaskStatus::Failed)?;
    transaction.execute("UPDATE tasks SET status='failed',error_code=?2,error_message=?3,updated_at=?4 WHERE id=?1 AND deleted_at IS NULL", params![task_id,limit_text(code,64),limit_text(message,500),Utc::now().to_rfc3339()]).map_err(db_error)?;
    transaction.commit().map_err(db_error)?;
    Ok(())
}

pub fn set_favorite(path: &Path, task_id: &str, favorite: bool) -> Result<(), CommandError> {
    open(path)?
        .execute(
            "UPDATE tasks SET favorite=?2,updated_at=?3 WHERE id=?1 AND deleted_at IS NULL",
            params![task_id, favorite, Utc::now().to_rfc3339()],
        )
        .map_err(db_error)?;
    Ok(())
}

pub fn set_tags(path: &Path, task_id: &str, tags: &[String]) -> Result<(), CommandError> {
    let tags = tags
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if tags.len() > 12 {
        return Err(CommandError::new("tag_invalid", "每个任务最多 12 个标签"));
    }
    if tags.iter().any(|value| value.chars().count() > 24) {
        return Err(CommandError::new("tag_invalid", "标签最多 24 个字符"));
    }
    let mut connection = open(path)?;
    let transaction = connection.transaction().map_err(db_error)?;
    transaction
        .execute("DELETE FROM task_tags WHERE task_id=?1", params![task_id])
        .map_err(db_error)?;
    for tag in tags {
        transaction
            .execute(
                "INSERT OR IGNORE INTO tags(id,name) VALUES(?1,?2)",
                params![Uuid::new_v4().to_string(), tag],
            )
            .map_err(db_error)?;
        let tag_id: String = transaction
            .query_row(
                "SELECT id FROM tags WHERE name=?1 COLLATE NOCASE",
                params![tag],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        transaction
            .execute(
                "INSERT INTO task_tags(task_id,tag_id) VALUES(?1,?2)",
                params![task_id, tag_id],
            )
            .map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)
}

pub fn move_tasks(path: &Path, ids: &[String], project_id: &str) -> Result<usize, CommandError> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut connection = open(path)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let mut position: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(queue_position),-1)+1 FROM tasks WHERE project_id=?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    let mut count = 0;
    for id in ids {
        count += transaction.execute("UPDATE tasks SET project_id=?2,queue_position=?3,updated_at=?4 WHERE id=?1 AND deleted_at IS NULL", params![id,project_id,position,Utc::now().to_rfc3339()]).map_err(db_error)?;
        position += 1;
    }
    transaction.commit().map_err(db_error)?;
    Ok(count)
}

pub fn reorder_tasks(path: &Path, ids: &[String]) -> Result<(), CommandError> {
    let mut connection = open(path)?;
    let transaction = connection.transaction().map_err(db_error)?;
    for (position, id) in ids.iter().enumerate() {
        transaction.execute("UPDATE tasks SET queue_position=?2,updated_at=?3 WHERE id=?1 AND deleted_at IS NULL", params![id,position as i64,Utc::now().to_rfc3339()]).map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)
}

pub fn duplicate_task(path: &Path, source_id: &str) -> Result<ProjectTask, CommandError> {
    let source = get_task(path, source_id)?;
    let original_asset_id: Option<String> = open(path)?
        .query_row(
            "SELECT original_asset_id FROM tasks WHERE id=?1",
            params![source_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?
        .flatten();
    let now = Utc::now().to_rfc3339();
    let task = ProjectTask {
        id: Uuid::new_v4().to_string(),
        title: format!("{} 副本", source.title),
        status: if source.original_image.is_some() {
            TaskStatus::Ready
        } else {
            TaskStatus::Blocked
        },
        result: None,
        error_code: None,
        error_message: None,
        parent_task_id: Some(source.id),
        queue_position: next_queue_position(path, &source.project_id)?,
        created_at: now.clone(),
        updated_at: now,
        ..source
    };
    insert_task(path, &task, original_asset_id.as_deref())?;
    if !task.tags.is_empty() {
        set_tags(path, &task.id, &task.tags)?;
    }
    Ok(task)
}

pub fn soft_delete_tasks(path: &Path, ids: &[String]) -> Result<usize, CommandError> {
    let now = Utc::now().to_rfc3339();
    let mut connection = open(path)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let mut count = 0;
    for id in ids {
        count += transaction.execute("UPDATE tasks SET deleted_at=?2,status='cancelled',updated_at=?2 WHERE id=?1 AND deleted_at IS NULL", params![id,now]).map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)?;
    Ok(count)
}

pub fn soft_delete_project(path: &Path, id: &str) -> Result<(), CommandError> {
    if id == DEFAULT_PROJECT_ID || id == HISTORY_PROJECT_ID {
        return Err(CommandError::new("project_protected", "默认项目不能删除"));
    }
    let mut connection = open(path)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let now = Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE projects SET deleted_at=?2,updated_at=?2 WHERE id=?1 AND deleted_at IS NULL",
            params![id, now],
        )
        .map_err(db_error)?;
    transaction.execute("UPDATE tasks SET deleted_at=?2,status='cancelled',updated_at=?2 WHERE project_id=?1 AND deleted_at IS NULL",params![id,now]).map_err(db_error)?;
    transaction.commit().map_err(db_error)
}

pub fn list_trash(path: &Path) -> Result<Vec<TrashEntry>, CommandError> {
    let connection = open(path)?;
    let mut values = Vec::new();
    let mut projects = connection
        .prepare("SELECT id,title,deleted_at FROM projects WHERE deleted_at IS NOT NULL")
        .map_err(db_error)?;
    for row in projects
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(db_error)?
    {
        let (id, title, deleted_at) = row.map_err(db_error)?;
        values.push(trash_entry(id, "project", title, deleted_at));
    }
    let mut tasks=connection.prepare("SELECT id,title,deleted_at FROM tasks WHERE deleted_at IS NOT NULL AND project_id IN (SELECT id FROM projects WHERE deleted_at IS NULL)").map_err(db_error)?;
    for row in tasks
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(db_error)?
    {
        let (id, title, deleted_at) = row.map_err(db_error)?;
        values.push(trash_entry(id, "task", title, deleted_at));
    }
    values.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(values)
}

pub fn restore_trash(path: &Path, id: &str, kind: &str) -> Result<(), CommandError> {
    let connection = open(path)?;
    match kind {
        "project" => {
            connection
                .execute(
                    "UPDATE projects SET deleted_at=NULL,updated_at=?2 WHERE id=?1",
                    params![id, Utc::now().to_rfc3339()],
                )
                .map_err(db_error)?;
            connection.execute("UPDATE tasks SET deleted_at=NULL,status=CASE WHEN result_json IS NULL THEN 'paused' ELSE 'completed' END,updated_at=?2 WHERE project_id=?1",params![id,Utc::now().to_rfc3339()]).map_err(db_error)?;
        }
        "task" => {
            connection.execute("UPDATE tasks SET deleted_at=NULL,status=CASE WHEN result_json IS NULL THEN 'paused' ELSE 'completed' END,updated_at=?2 WHERE id=?1",params![id,Utc::now().to_rfc3339()]).map_err(db_error)?;
        }
        _ => return Err(CommandError::new("trash_invalid", "废纸篓项目类型无效")),
    }
    Ok(())
}

pub fn permanent_delete(path: &Path, id: &str, kind: &str) -> Result<Vec<String>, CommandError> {
    let mut connection = open(path)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let exists_in_trash = match kind {
        "project" => transaction
            .query_row(
                "SELECT 1 FROM projects WHERE id=?1 AND deleted_at IS NOT NULL",
                params![id],
                |_| Ok(()),
            )
            .optional()
            .map_err(db_error)?
            .is_some(),
        "task" => transaction
            .query_row(
                "SELECT 1 FROM tasks WHERE id=?1 AND deleted_at IS NOT NULL",
                params![id],
                |_| Ok(()),
            )
            .optional()
            .map_err(db_error)?
            .is_some(),
        _ => return Err(CommandError::new("trash_invalid", "废纸篓项目类型无效")),
    };
    if !exists_in_trash {
        return Err(CommandError::new("trash_missing", "废纸篓项目不存在"));
    }
    let assets=match kind {
        "project" => asset_candidates(&transaction,"SELECT DISTINCT original_asset_id FROM tasks WHERE project_id=?1 AND original_asset_id IS NOT NULL",id)?,
        "task" => asset_candidates(&transaction,"SELECT original_asset_id FROM tasks WHERE id=?1 AND original_asset_id IS NOT NULL",id)?,
        _ => return Err(CommandError::new("trash_invalid", "废纸篓项目类型无效")),
    };
    match kind {
        "project" => {
            transaction
                .execute("DELETE FROM tasks WHERE project_id=?1", params![id])
                .map_err(db_error)?;
            transaction
                .execute(
                    "DELETE FROM projects WHERE id=?1 AND deleted_at IS NOT NULL",
                    params![id],
                )
                .map_err(db_error)?;
        }
        _ => {
            transaction
                .execute(
                    "DELETE FROM tasks WHERE id=?1 AND deleted_at IS NOT NULL",
                    params![id],
                )
                .map_err(db_error)?;
        }
    }
    let removable = assets
        .into_iter()
        .filter(|asset| {
            transaction
                .query_row(
                    "SELECT COUNT(*) FROM tasks WHERE original_asset_id=?1",
                    params![asset],
                    |row| row.get::<_, u64>(0),
                )
                .unwrap_or(1)
                == 0
        })
        .collect();
    transaction.commit().map_err(db_error)?;
    Ok(removable)
}

pub fn original_asset_ids(path: &Path) -> Result<Vec<String>, CommandError> {
    let connection = open(path)?;
    let mut statement = connection
        .prepare("SELECT DISTINCT original_asset_id FROM tasks WHERE original_asset_id IS NOT NULL")
        .map_err(db_error)?;
    let rows = statement
        .query_map([], |row| row.get(0))
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

pub fn purge_expired(path: &Path) -> Result<Vec<String>, CommandError> {
    let cutoff = (Utc::now() - Duration::days(30)).to_rfc3339();
    let entries = list_trash(path)?;
    let mut assets = Vec::new();
    for entry in entries
        .into_iter()
        .filter(|entry| entry.deleted_at < cutoff)
    {
        assets.extend(permanent_delete(path, &entry.id, &entry.kind)?);
    }
    Ok(assets)
}

pub fn list_presets(path: &Path) -> Result<Vec<ReversePreset>, CommandError> {
    let connection = open(path)?;
    let mut statement=connection.prepare("SELECT id,title,built_in,snapshot_json,created_at,updated_at FROM presets WHERE deleted_at IS NULL ORDER BY built_in DESC,created_at ASC").map_err(db_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(ReversePreset {
                id: row.get(0)?,
                title: row.get(1)?,
                built_in: row.get(2)?,
                snapshot: parse_sql(row.get::<_, String>(3)?)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

pub fn save_preset(
    path: &Path,
    id: Option<&str>,
    title: &str,
    snapshot: &ReversePresetSnapshot,
) -> Result<ReversePreset, CommandError> {
    let title = validate_title(title, "预设名称")?;
    validate_preset_snapshot(snapshot)?;
    let connection = open(path)?;
    let now = Utc::now().to_rfc3339();
    let id = id
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    if connection
        .query_row(
            "SELECT built_in FROM presets WHERE id=?1",
            params![id],
            |row| row.get::<_, bool>(0),
        )
        .optional()
        .map_err(db_error)?
        .unwrap_or(false)
    {
        return Err(CommandError::new(
            "preset_protected",
            "内置预设请先复制后编辑",
        ));
    }
    connection.execute("INSERT INTO presets(id,title,built_in,snapshot_json,created_at,updated_at) VALUES(?1,?2,0,?3,?4,?4) ON CONFLICT(id) DO UPDATE SET title=excluded.title,snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at,deleted_at=NULL",params![id,title,json(snapshot)?,now]).map_err(db_error)?;
    Ok(ReversePreset {
        id,
        title,
        built_in: false,
        snapshot: snapshot.clone(),
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn delete_preset(path: &Path, id: &str) -> Result<(), CommandError> {
    let changed = open(path)?
        .execute(
            "UPDATE presets SET deleted_at=?2 WHERE id=?1 AND built_in=0",
            params![id, Utc::now().to_rfc3339()],
        )
        .map_err(db_error)?;
    if changed == 0 {
        return Err(CommandError::new("preset_protected", "内置预设不能删除"));
    }
    Ok(())
}

pub fn batch_progress(path: &Path, project_id: &str) -> Result<BatchProgress, CommandError> {
    let connection = open(path)?;
    let mut result = BatchProgress::default();
    let mut statement=connection.prepare("SELECT status,COUNT(*) FROM tasks WHERE project_id=?1 AND deleted_at IS NULL GROUP BY status").map_err(db_error)?;
    for row in statement
        .query_map(params![project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
        })
        .map_err(db_error)?
    {
        let (status, count) = row.map_err(db_error)?;
        result.total += count;
        match status.as_str() {
            "ready" => result.ready += count,
            "queued" => result.queued += count,
            "preparing" | "running" => result.running += count,
            "completed" => result.completed += count,
            "failed" | "blocked" => result.failed += count,
            "paused" | "cancelled" => result.paused += count,
            _ => {}
        }
    }
    Ok(result)
}

pub fn pause_active_tasks(path: &Path) -> Result<usize, CommandError> {
    open(path)?.execute(
        "UPDATE tasks SET status='paused',updated_at=?1 WHERE deleted_at IS NULL AND status IN ('queued','preparing','running')",
        params![Utc::now().to_rfc3339()],
    ).map_err(db_error)
}

fn task_from_row(row: &Row<'_>) -> rusqlite::Result<ProjectTask> {
    let status: String = row.get(8)?;
    Ok(ProjectTask {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        file_name: row.get(3)?,
        thumbnail: row.get(4)?,
        image_info: parse_sql_opt(row.get(5)?),
        original_image: parse_sql_opt(row.get(6)?),
        capture_metadata: parse_sql_opt(row.get(7)?),
        status: parse_status(&status),
        favorite: row.get(9)?,
        tags: Vec::new(),
        preset_snapshot: parse_sql_opt(row.get(10)?),
        result: parse_sql_opt(row.get(11)?),
        error_code: row.get(12)?,
        error_message: row.get(13)?,
        parent_task_id: row.get(14)?,
        queue_position: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}
fn parse_status(value: &str) -> TaskStatus {
    match value {
        "queued" => TaskStatus::Queued,
        "preparing" => TaskStatus::Preparing,
        "running" => TaskStatus::Running,
        "completed" => TaskStatus::Completed,
        "failed" => TaskStatus::Failed,
        "paused" => TaskStatus::Paused,
        "cancelled" => TaskStatus::Cancelled,
        "blocked" => TaskStatus::Blocked,
        _ => TaskStatus::Ready,
    }
}
fn can_transition(current: &str, next: TaskStatus) -> bool {
    if current == next.as_str() {
        return current != TaskStatus::Completed.as_str();
    }
    match current {
        "ready" => matches!(
            next,
            TaskStatus::Queued | TaskStatus::Paused | TaskStatus::Cancelled
        ),
        "queued" => matches!(
            next,
            TaskStatus::Preparing | TaskStatus::Paused | TaskStatus::Cancelled
        ),
        "preparing" => matches!(
            next,
            TaskStatus::Running | TaskStatus::Paused | TaskStatus::Failed | TaskStatus::Cancelled
        ),
        "running" => matches!(
            next,
            TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Paused | TaskStatus::Cancelled
        ),
        "failed" | "blocked" => matches!(
            next,
            TaskStatus::Ready | TaskStatus::Queued | TaskStatus::Paused | TaskStatus::Cancelled
        ),
        "paused" | "cancelled" => matches!(
            next,
            TaskStatus::Ready | TaskStatus::Queued | TaskStatus::Cancelled | TaskStatus::Paused
        ),
        "completed" => false,
        _ => false,
    }
}

fn ensure_task_transition(
    transaction: &Transaction<'_>,
    task_id: &str,
    next: TaskStatus,
) -> Result<(), CommandError> {
    let current = transaction
        .query_row(
            "SELECT status FROM tasks WHERE id=?1 AND deleted_at IS NULL",
            params![task_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| CommandError::new("task_missing", "任务不存在"))?;
    if !can_transition(&current, next) {
        return Err(CommandError::new(
            "task_status_invalid",
            format!("任务状态不能从 {current} 变更为 {}", next.as_str()),
        ));
    }
    Ok(())
}
fn task_tags(connection: &Connection, id: &str) -> Result<Vec<String>, CommandError> {
    let mut statement=connection.prepare("SELECT g.name FROM tags g JOIN task_tags tt ON tt.tag_id=g.id WHERE tt.task_id=?1 ORDER BY g.name").map_err(db_error)?;
    let result = statement
        .query_map(params![id], |row| row.get(0))
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error);
    result
}
fn validate_title(value: &str, label: &str) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 64 || value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "title_invalid",
            format!("{label}需为 1 至 64 个字符"),
        ));
    }
    Ok(value.to_owned())
}
fn validate_task(task: &ProjectTask) -> Result<(), CommandError> {
    validate_title(&task.title, "任务名称")?;
    if task.project_id.is_empty()
        || task.project_id.len() > 128
        || task.project_id.chars().any(char::is_control)
    {
        return Err(CommandError::new("project_id_invalid", "项目标识无效"));
    }
    if task.file_name.trim().is_empty()
        || task.file_name.chars().count() > MAX_FILE_NAME_CHARS
        || task.file_name.chars().any(char::is_control)
    {
        return Err(CommandError::new(
            "file_name_invalid",
            "图片文件名需为 1 至 255 个字符",
        ));
    }
    if let Some(thumbnail) = task.thumbnail.as_deref() {
        crate::store::validate_thumbnail(thumbnail)?;
    }
    if let Some(image) = task.image_info.as_ref() {
        if image.name.chars().count() > MAX_FILE_NAME_CHARS
            || !matches!(
                image.mime_type.as_str(),
                "image/png" | "image/jpeg" | "image/webp"
            )
        {
            return Err(CommandError::new("image_info_invalid", "图片信息无效"));
        }
    }
    if let Some(snapshot) = task.preset_snapshot.as_ref() {
        validate_preset_snapshot(snapshot)?;
    }
    if let Some(result) = task.result.as_ref() {
        bounded_json(
            result,
            MAX_RESULT_BYTES,
            "task_result_too_large",
            "任务结果超过 2 MiB 限制",
        )?;
    }
    Ok(())
}
fn validate_preset_snapshot(snapshot: &ReversePresetSnapshot) -> Result<(), CommandError> {
    if snapshot.requirements.chars().count() > MAX_REQUIREMENTS_CHARS {
        return Err(CommandError::new(
            "preset_invalid",
            "预设补充要求最多 2000 个字符",
        ));
    }
    if snapshot.auto_optimize_requirements.chars().count() > MAX_OPTIMIZATION_REQUIREMENTS_CHARS {
        return Err(CommandError::new(
            "preset_invalid",
            "自动优化要求最多 500 个字符",
        ));
    }
    Ok(())
}
fn json<T: Serialize>(value: &T) -> Result<String, CommandError> {
    serde_json::to_string(value).map_err(db_error)
}
fn bounded_json<T: Serialize>(
    value: &T,
    max_bytes: usize,
    code: &str,
    message: &str,
) -> Result<String, CommandError> {
    let serialized = json(value)?;
    if serialized.len() > max_bytes {
        return Err(CommandError::new(code, message));
    }
    Ok(serialized)
}
fn json_opt<T: Serialize>(value: &Option<T>) -> Result<Option<String>, CommandError> {
    value.as_ref().map(json).transpose()
}
fn parse<T: DeserializeOwned>(value: &str) -> Result<T, CommandError> {
    serde_json::from_str(value).map_err(db_error)
}
fn parse_sql<T: DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })
}
fn parse_sql_opt<T: DeserializeOwned>(value: Option<String>) -> Option<T> {
    value.and_then(|value| serde_json::from_str(&value).ok())
}
fn limit_text(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}
fn trash_entry(id: String, kind: &str, title: String, deleted_at: String) -> TrashEntry {
    let purge_at = chrono::DateTime::parse_from_rfc3339(&deleted_at)
        .map(|value| (value + Duration::days(30)).to_rfc3339())
        .unwrap_or_default();
    TrashEntry {
        id,
        kind: kind.into(),
        title,
        deleted_at,
        purge_at,
    }
}
fn asset_candidates(
    transaction: &Transaction<'_>,
    sql: &str,
    id: &str,
) -> Result<Vec<String>, CommandError> {
    let mut statement = transaction.prepare(sql).map_err(db_error)?;
    let result = statement
        .query_map(params![id], |row| row.get(0))
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn test_task(id: &str, status: TaskStatus, result: Option<ReverseResult>) -> ProjectTask {
        let now = Utc::now().to_rfc3339();
        ProjectTask {
            id: id.into(),
            project_id: DEFAULT_PROJECT_ID.into(),
            title: "任务".into(),
            file_name: "a.jpg".into(),
            thumbnail: None,
            image_info: None,
            original_image: None,
            capture_metadata: None,
            status,
            favorite: false,
            tags: vec![],
            preset_snapshot: None,
            result,
            error_code: None,
            error_message: None,
            parent_task_id: None,
            queue_position: 0,
            created_at: now.clone(),
            updated_at: now,
        }
    }

    #[test]
    fn initializes_defaults_and_filters_tasks() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        initialize(&path, &[]).unwrap();
        assert_eq!(list_projects(&path).unwrap()[0].title, "我的项目");
        assert_eq!(list_presets(&path).unwrap().len(), 4);
        let project = create_project(&path, "测试项目").unwrap();
        assert_eq!(project.title, "测试项目");
        assert_eq!(
            list_tasks(&path, &project.id, TaskFilter::All, "", 0, 50)
                .unwrap()
                .total,
            0
        );
    }

    #[test]
    fn migrates_history_only_once() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        let item = HistoryItem {
            id: "legacy-1".into(),
            title: "旧任务".into(),
            input_summary: "a.jpg".into(),
            thumbnail: None,
            image_info: None,
            original_image: None,
            capture_metadata: None,
            result: ReverseResult::default(),
            created_at: Utc::now().to_rfc3339(),
        };
        initialize(&path, &[item.clone()]).unwrap();
        initialize(&path, &[item]).unwrap();
        assert_eq!(
            list_tasks(&path, HISTORY_PROJECT_ID, TaskFilter::All, "", 0, 50)
                .unwrap()
                .total,
            1
        );
    }

    #[test]
    fn soft_delete_restores_and_purges_task() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        initialize(&path, &[]).unwrap();
        let now = Utc::now().to_rfc3339();
        let task = ProjectTask {
            id: "task-1".into(),
            project_id: DEFAULT_PROJECT_ID.into(),
            title: "任务".into(),
            file_name: "a.jpg".into(),
            thumbnail: None,
            image_info: None,
            original_image: None,
            capture_metadata: None,
            status: TaskStatus::Ready,
            favorite: false,
            tags: vec![],
            preset_snapshot: None,
            result: None,
            error_code: None,
            error_message: None,
            parent_task_id: None,
            queue_position: 0,
            created_at: now.clone(),
            updated_at: now,
        };
        insert_task(&path, &task, None).unwrap();
        soft_delete_tasks(&path, &[task.id.clone()]).unwrap();
        assert_eq!(list_trash(&path).unwrap().len(), 1);
        restore_trash(&path, &task.id, "task").unwrap();
        assert!(list_trash(&path).unwrap().is_empty());
    }

    #[test]
    fn task_state_machine_rejects_completed_overwrite() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        initialize(&path, &[]).unwrap();
        let now = Utc::now().to_rfc3339();
        let task = ProjectTask {
            id: "task-state".into(),
            project_id: DEFAULT_PROJECT_ID.into(),
            title: "任务".into(),
            file_name: "a.jpg".into(),
            thumbnail: None,
            image_info: None,
            original_image: None,
            capture_metadata: None,
            status: TaskStatus::Completed,
            favorite: false,
            tags: vec![],
            preset_snapshot: None,
            result: Some(ReverseResult::default()),
            error_code: None,
            error_message: None,
            parent_task_id: None,
            queue_position: 0,
            created_at: now.clone(),
            updated_at: now,
        };
        insert_task(&path, &task, None).unwrap();
        let error = update_task_status(&path, &[task.id], TaskStatus::Queued).unwrap_err();
        assert_eq!(error.code, "task_status_invalid");
    }

    #[test]
    fn rejects_oversized_workspace_fields() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        initialize(&path, &[]).unwrap();
        assert_eq!(
            list_tasks(
                &path,
                DEFAULT_PROJECT_ID,
                TaskFilter::All,
                &"x".repeat(501),
                0,
                50
            )
            .unwrap_err()
            .code,
            "task_query_invalid"
        );
        let snapshot = ReversePresetSnapshot {
            requirements: "x".repeat(MAX_REQUIREMENTS_CHARS + 1),
            ..Default::default()
        };
        assert_eq!(
            save_preset(&path, None, "测试", &snapshot)
                .unwrap_err()
                .code,
            "preset_invalid"
        );
    }

    #[test]
    fn task_list_omits_heavy_result_but_get_task_returns_it() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        initialize(&path, &[]).unwrap();
        let task = test_task(
            "task-with-result",
            TaskStatus::Completed,
            Some(ReverseResult::default()),
        );
        insert_task(&path, &task, None).unwrap();

        let listed = list_tasks(&path, DEFAULT_PROJECT_ID, TaskFilter::All, "", 0, 50)
            .unwrap()
            .items
            .pop()
            .unwrap();
        assert!(listed.result.is_none());
        assert!(get_task(&path, &task.id).unwrap().result.is_some());
    }

    #[test]
    fn permanent_delete_rejects_active_project_and_preserves_tasks() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        initialize(&path, &[]).unwrap();
        let task = test_task("active-task", TaskStatus::Ready, None);
        insert_task(&path, &task, Some("asset-1")).unwrap();

        let error = permanent_delete(&path, DEFAULT_PROJECT_ID, "project").unwrap_err();

        assert_eq!(error.code, "trash_missing");
        assert_eq!(get_task(&path, &task.id).unwrap().id, task.id);
        assert_eq!(original_asset_ids(&path).unwrap(), vec!["asset-1"]);
    }

    #[test]
    fn terminal_writes_enforce_task_state_machine() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        initialize(&path, &[]).unwrap();
        let completed = test_task(
            "completed-task",
            TaskStatus::Completed,
            Some(ReverseResult::default()),
        );
        insert_task(&path, &completed, None).unwrap();

        assert_eq!(
            complete_task(&path, &completed.id, &ReverseResult::default())
                .unwrap_err()
                .code,
            "task_status_invalid"
        );
        assert_eq!(
            fail_task(&path, &completed.id, "timeout", "超时")
                .unwrap_err()
                .code,
            "task_status_invalid"
        );

        let running = test_task("running-task", TaskStatus::Running, None);
        insert_task(&path, &running, None).unwrap();
        complete_task(&path, &running.id, &ReverseResult::default()).unwrap();
        assert_eq!(
            get_task(&path, &running.id).unwrap().status,
            TaskStatus::Completed
        );
    }

    #[test]
    fn completed_result_can_be_updated_without_reopening_terminal_transition() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        initialize(&path, &[]).unwrap();
        let completed = test_task(
            "editable-completed-task",
            TaskStatus::Completed,
            Some(ReverseResult::default()),
        );
        insert_task(&path, &completed, None).unwrap();
        let mut updated = ReverseResult::default();
        updated.prompts.zh = "手工派生版本".into();

        update_task_result(&path, &completed.id, &updated).unwrap();

        let task = get_task(&path, &completed.id).unwrap();
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(task.result.unwrap().prompts.zh, "手工派生版本");

        let running = test_task("non-editable-running-task", TaskStatus::Running, None);
        insert_task(&path, &running, None).unwrap();
        assert_eq!(
            update_task_result(&path, &running.id, &updated)
                .unwrap_err()
                .code,
            "task_status_invalid"
        );
    }
}
