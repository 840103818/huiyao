use std::{fs, path::Path};

use serde_json::Value;

use crate::models::{CommandError, HistoryItem, SettingsFile};

const HISTORY_LIMIT: usize = 50;

pub fn read_settings(path: &Path) -> Result<SettingsFile, CommandError> {
    if !path.exists() {
        return Ok(SettingsFile::default());
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| CommandError::new("settings_read", error.to_string()))?;
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
    let contents = fs::read_to_string(path)
        .map_err(|error| CommandError::new("history_read", error.to_string()))?;
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
    write_json(path, &limited, "history_write")
}

fn write_json<T: serde::Serialize + ?Sized>(
    path: &Path,
    value: &T,
    code: &str,
) -> Result<(), CommandError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| CommandError::new(code, error.to_string()))?;
    }
    let body = serde_json::to_vec_pretty(value)
        .map_err(|error| CommandError::new(code, error.to_string()))?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, body)
        .and_then(|_| fs::rename(&temporary, path))
        .map_err(|error| CommandError::new(code, error.to_string()))
}

pub fn migrate_legacy_data(old_dir: &Path, new_dir: &Path) -> Result<usize, CommandError> {
    fs::create_dir_all(new_dir)
        .map_err(|error| CommandError::new("migration_write", error.to_string()))?;
    let mut migrated = 0;
    for filename in ["settings.json", "runtime.jsonl"] {
        let source = old_dir.join(filename);
        let destination = new_dir.join(filename);
        if source.exists() && !destination.exists() {
            fs::copy(source, destination)
                .map_err(|error| CommandError::new("migration_write", error.to_string()))?;
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
        assert!(!fs::read_to_string(path).unwrap().contains("\"mode\""));
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
}
