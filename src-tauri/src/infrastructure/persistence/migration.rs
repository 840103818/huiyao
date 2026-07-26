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

