use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

use serde_json::Value;

use crate::models::{CommandError, HistoryItem, SettingsFile};

const HISTORY_LIMIT: usize = 50;
const MAX_HISTORY_BYTES: usize = 32 * 1024 * 1024;
const MAX_HISTORY_ITEM_BYTES: usize = 2 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES: usize = 1024 * 1024;
const MAX_SETTINGS_BYTES: usize = 64 * 1024;

pub fn read_settings(path: &Path) -> Result<SettingsFile, CommandError> {
    if !path.exists() {
        return Ok(SettingsFile::default());
    }
    let contents = read_bounded(path, MAX_SETTINGS_BYTES, "settings_read")?;
    serde_json::from_str(&contents)
        .map_err(|error| CommandError::new("settings_invalid", error.to_string()))
}

pub fn write_settings(path: &Path, settings: &SettingsFile) -> Result<(), CommandError> {
    write_json(path, settings, "settings_write")
}

pub fn read_history(path: &Path) -> Result<Vec<HistoryItem>, CommandError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let contents = read_bounded(path, MAX_HISTORY_BYTES, "history_read")?;
    let values: Vec<Value> = serde_json::from_str(&contents)
        .map_err(|error| CommandError::new("history_invalid", error.to_string()))?;
    let (items, changed) = clean_legacy_history(values)?;
    if changed {
        write_history(path, &items)?;
    }
    Ok(items)
}

pub fn write_history(path: &Path, items: &[HistoryItem]) -> Result<(), CommandError> {
    let limited = items
        .iter()
        .take(HISTORY_LIMIT)
        .cloned()
        .collect::<Vec<_>>();
    validate_history(&limited)?;
    write_json(path, &limited, "history_write")
}

fn validate_history(items: &[HistoryItem]) -> Result<(), CommandError> {
    let mut total = 0usize;
    for item in items {
        if item.id.chars().count() > 128
            || item.title.trim().is_empty()
            || item.title.chars().count() > 32
            || item.input_summary.chars().count() > 255
            || item.created_at.chars().count() > 64
        {
            return Err(CommandError::new("history_invalid", "历史记录包含无效字段"));
        }
        if let Some(thumbnail) = item.thumbnail.as_deref() {
            validate_thumbnail(thumbnail)?;
        }
        if let Some(info) = item.image_info.as_ref() {
            if info.name.chars().count() > 255
                || info.mime_type.chars().count() > 64
                || info.width as usize > 32_768
                || info.height as usize > 32_768
            {
                return Err(CommandError::new(
                    "history_image_info_invalid",
                    "历史图片信息包含无效字段",
                ));
            }
        }
        if let Some(original) = item.original_image.as_ref() {
            if original.file_name.trim().is_empty()
                || original.file_name.chars().count() > 255
                || original
                    .file_name
                    .chars()
                    .any(|value| value.is_control() || matches!(value, '/' | '\\'))
                || !item
                    .id
                    .bytes()
                    .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
                || !matches!(
                    original.mime_type.as_str(),
                    "image/png" | "image/jpeg" | "image/webp"
                )
                || original.size == 0
                || original.size > 20 * 1024 * 1024
                || original.stored_at.chars().count() > 64
                || original.encryption_version != 1
            {
                return Err(CommandError::new(
                    "history_original_invalid",
                    "历史原图信息包含无效字段",
                ));
            }
        }
        if item.capture_metadata.as_ref().is_some_and(|metadata| {
            [
                metadata.camera_make.as_deref(),
                metadata.camera_model.as_deref(),
                metadata.lens_make.as_deref(),
                metadata.lens_model.as_deref(),
                metadata.focal_length.as_deref(),
                metadata.focal_length_35mm.as_deref(),
                metadata.aperture.as_deref(),
                metadata.exposure_time.as_deref(),
                metadata.iso.as_deref(),
                metadata.exposure_bias.as_deref(),
                metadata.flash.as_deref(),
                metadata.white_balance.as_deref(),
                metadata.captured_at.as_deref(),
                metadata.color_space.as_deref(),
            ]
            .into_iter()
            .flatten()
            .any(|value| value.chars().count() > 160 || value.chars().any(char::is_control))
        }) {
            return Err(CommandError::new(
                "history_capture_metadata_invalid",
                "文件实拍信息包含无效字段",
            ));
        }
        if item.result.prompt_versions.len() > 8 {
            return Err(CommandError::new(
                "history_prompt_versions_invalid",
                "单条历史记录最多保存 8 个提示词优化版本",
            ));
        }
        for version in &item.result.prompt_versions {
            if version.id.is_empty()
                || version.id.chars().count() > 128
                || version.requirements.chars().count() > 500
                || version
                    .title
                    .as_ref()
                    .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 32)
                || version
                    .source_version_id
                    .as_ref()
                    .is_some_and(|value| value.chars().count() > 128)
                || version.prompts.zh.chars().count() > 50_000
                || version.prompts.en.chars().count() > 50_000
                || version.negative_prompts.zh.chars().count() > 50_000
                || version.negative_prompts.en.chars().count() > 50_000
                || version.metadata.created_at.chars().count() > 64
            {
                return Err(CommandError::new(
                    "history_prompt_versions_invalid",
                    "提示词优化版本包含无效字段",
                ));
            }
        }
        if item
            .result
            .active_prompt_version_id
            .as_ref()
            .is_some_and(|active| {
                !item
                    .result
                    .prompt_versions
                    .iter()
                    .any(|version| &version.id == active)
            })
        {
            return Err(CommandError::new(
                "history_prompt_versions_invalid",
                "当前提示词版本不存在",
            ));
        }
        let bytes = serde_json::to_vec(item)
            .map_err(|error| CommandError::new("history_invalid", error.to_string()))?;
        if bytes.len() > MAX_HISTORY_ITEM_BYTES {
            return Err(CommandError::new(
                "history_item_too_large",
                "单条历史记录超过安全限制",
            ));
        }
        total = total.saturating_add(bytes.len());
    }
    if total > MAX_HISTORY_BYTES {
        return Err(CommandError::new(
            "history_too_large",
            "历史记录总大小超过安全限制",
        ));
    }
    Ok(())
}

fn validate_thumbnail(value: &str) -> Result<(), CommandError> {
    if value.len() > MAX_THUMBNAIL_BYTES {
        return Err(CommandError::new(
            "history_thumbnail_invalid",
            "历史缩略图格式或大小无效",
        ));
    }
    let encoded = [
        "data:image/jpeg;base64,",
        "data:image/png;base64,",
        "data:image/webp;base64,",
    ]
    .iter()
    .find_map(|prefix| value.strip_prefix(prefix))
    .ok_or_else(|| CommandError::new("history_thumbnail_invalid", "历史缩略图格式或大小无效"))?;
    let decoded = BASE64
        .decode(encoded)
        .map_err(|_| CommandError::new("history_thumbnail_invalid", "历史缩略图数据无效"))?;
    let size = imagesize::blob_size(&decoded)
        .map_err(|_| CommandError::new("history_thumbnail_invalid", "历史缩略图数据无效"))?;
    if size.width > 320 || size.height > 320 {
        return Err(CommandError::new(
            "history_thumbnail_invalid",
            "历史缩略图尺寸超过限制",
        ));
    }
    Ok(())
}

fn read_bounded(path: &Path, max_bytes: usize, code: &str) -> Result<String, CommandError> {
    let metadata =
        fs::metadata(path).map_err(|error| CommandError::new(code, error.to_string()))?;
    if metadata.len() > max_bytes as u64 {
        return Err(CommandError::new(code, "本地数据文件超过安全限制"));
    }
    fs::read_to_string(path).map_err(|error| CommandError::new(code, error.to_string()))
}

fn write_json<T: serde::Serialize + ?Sized>(
    path: &Path,
    value: &T,
    code: &str,
) -> Result<(), CommandError> {
    if let Some(parent) = path.parent() {
        ensure_private_dir(parent, code)?;
    }
    let body = serde_json::to_vec_pretty(value)
        .map_err(|error| CommandError::new(code, error.to_string()))?;
    let temporary = path.with_extension("tmp");
    write_private_file(&temporary, &body, code)?;
    fs::rename(&temporary, path).map_err(|error| CommandError::new(code, error.to_string()))?;
    set_private_file_permissions(path, code)
}

pub fn ensure_private_dir(path: &Path, code: &str) -> Result<(), CommandError> {
    fs::create_dir_all(path).map_err(|error| CommandError::new(code, error.to_string()))?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| CommandError::new(code, error.to_string()))?;
    Ok(())
}

pub fn write_private_file(path: &Path, body: &[u8], code: &str) -> Result<(), CommandError> {
    if let Some(parent) = path.parent() {
        ensure_private_dir(parent, code)?;
    }
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .map_err(|error| CommandError::new(code, error.to_string()))?;
    file.write_all(body)
        .and_then(|_| file.sync_all())
        .map_err(|error| CommandError::new(code, error.to_string()))?;
    set_private_file_permissions(path, code)
}

pub fn set_private_file_permissions(path: &Path, code: &str) -> Result<(), CommandError> {
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| CommandError::new(code, error.to_string()))?;
    Ok(())
}

pub fn migrate_legacy_data(old_dir: &Path, new_dir: &Path) -> Result<usize, CommandError> {
    ensure_private_dir(new_dir, "migration_write")?;
    let mut migrated = 0;
    for filename in ["settings.json", "runtime.jsonl"] {
        let source = old_dir.join(filename);
        let destination = new_dir.join(filename);
        if source.exists() && !destination.exists() {
            fs::copy(source, destination)
                .map_err(|error| CommandError::new("migration_write", error.to_string()))?;
            set_private_file_permissions(&new_dir.join(filename), "migration_write")?;
            migrated += 1;
        }
    }

    let old_history = old_dir.join("history.json");
    let new_history = new_dir.join("history.json");
    if old_history.exists() && !new_history.exists() {
        let contents = fs::read_to_string(old_history)
            .map_err(|error| CommandError::new("migration_read", error.to_string()))?;
        let values: Vec<Value> = serde_json::from_str(&contents)
            .map_err(|error| CommandError::new("history_invalid", error.to_string()))?;
        let (items, _) = clean_legacy_history(values)?;
        write_history(&new_history, &items)?;
        migrated += 1;
    }
    Ok(migrated)
}

fn clean_legacy_history(values: Vec<Value>) -> Result<(Vec<HistoryItem>, bool), CommandError> {
    let original_len = values.len();
    let mut changed = false;
    let cleaned = values
        .into_iter()
        .filter_map(|mut value| {
            if value.get("mode").and_then(Value::as_str) == Some("text") {
                changed = true;
                return None;
            }
            if let Some(object) = value.as_object_mut() {
                changed |= object.remove("mode").is_some();
            }
            Some(value)
        })
        .collect::<Vec<_>>();
    changed |= cleaned.len() != original_len;
    let items = cleaned
        .into_iter()
        .map(serde_json::from_value)
        .collect::<Result<Vec<HistoryItem>, _>>()
        .map_err(|error| CommandError::new("history_invalid", error.to_string()))?;
    Ok((items, changed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ReverseResult;
    use tempfile::tempdir;

    #[test]
    fn history_is_limited_to_fifty_items() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("history.json");
        let items = (0..60)
            .map(|index| HistoryItem {
                id: index.to_string(),
                title: format!("item {index}"),
                input_summary: String::new(),
                thumbnail: None,
                image_info: None,
                original_image: None,
                capture_metadata: None,
                result: ReverseResult::default(),
                created_at: String::new(),
            })
            .collect::<Vec<_>>();

        write_history(&path, &items).unwrap();
        let loaded = read_history(&path).unwrap();

        assert_eq!(loaded.len(), 50);
        assert_eq!(loaded[0].id, "0");
        assert_eq!(loaded[49].id, "49");
    }

    #[test]
    fn removes_legacy_text_history_and_mode_field() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("history.json");
        fs::write(
            &path,
            r#"[
              {"id":"text","mode":"text","title":"old","inputSummary":"","result":{},"createdAt":""},
              {"id":"image","mode":"image","title":"keep","inputSummary":"","result":{},"createdAt":""}
            ]"#,
        )
        .unwrap();

        let items = read_history(&path).unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "image");
        assert!(items[0].result.analysis.scene.is_empty());
        assert!(items[0].result.analysis.tonality.is_empty());
        assert!(items[0].result.analysis.post_processing.is_empty());
        assert!(!fs::read_to_string(path).unwrap().contains("\"mode\""));
    }

    #[test]
    fn old_prompt_versions_default_to_model_optimization_origin() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("history.json");
        fs::write(
            &path,
            r#"[{"id":"image","title":"keep","inputSummary":"","result":{"promptVersions":[{"id":"v1","target":"general","requirements":"","prompts":{"zh":"提示词","en":"prompt"}}],"activePromptVersionId":"v1"},"createdAt":""}]"#,
        )
        .unwrap();

        let items = read_history(&path).unwrap();
        assert_eq!(
            items[0].result.prompt_versions[0].origin,
            crate::models::PromptVersionOrigin::Optimization
        );
        assert!(items[0].result.prompt_versions[0].title.is_none());
    }

    #[test]
    fn migration_is_idempotent_and_does_not_overwrite_new_data() {
        let directory = tempdir().unwrap();
        let old = directory.path().join("old");
        let new = directory.path().join("new");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("settings.json"), r#"{"model":"old"}"#).unwrap();

        assert_eq!(migrate_legacy_data(&old, &new).unwrap(), 1);
        fs::write(new.join("settings.json"), r#"{"model":"new"}"#).unwrap();
        assert_eq!(migrate_legacy_data(&old, &new).unwrap(), 0);
        assert!(fs::read_to_string(new.join("settings.json"))
            .unwrap()
            .contains("new"));
    }

    #[test]
    fn missing_settings_returns_defaults() {
        let directory = tempdir().unwrap();
        let settings = read_settings(&directory.path().join("missing.json")).unwrap();
        assert_eq!(settings.model, "gpt-4.1-mini");
    }

    #[test]
    fn old_settings_receive_safe_workspace_defaults() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("settings.json");
        fs::write(
            &path,
            r#"{"baseUrl":"https://api.example.com/v1","model":"vision","timeoutSeconds":30,"theme":"system"}"#,
        )
        .unwrap();

        let settings = read_settings(&path).unwrap();

        assert!(settings.auto_save_history);
        assert_eq!(
            settings.workspace.output_language,
            crate::models::OutputLanguage::Chinese
        );
        assert_eq!(
            settings.workspace.detail_level,
            crate::models::DetailLevel::Expert
        );
    }

    #[cfg(unix)]
    #[test]
    fn private_data_uses_restricted_permissions() {
        let directory = tempdir().unwrap();
        let data_dir = directory.path().join("private");
        let path = data_dir.join("settings.json");
        write_settings(&path, &SettingsFile::default()).unwrap();

        assert_eq!(
            fs::metadata(&data_dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
