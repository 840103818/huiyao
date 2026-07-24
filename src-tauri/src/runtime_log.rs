use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::CommandError;

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LOG_ENTRIES: usize = 500;
static LOG_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogEntry {
    pub id: String,
    pub timestamp: String,
    pub level: LogLevel,
    pub category: String,
    pub event: String,
    pub message: String,
    #[serde(default)]
    pub details: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

pub fn correlation_id() -> String {
    format!(
        "req-{}-{}",
        Utc::now().timestamp_millis(),
        LOG_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

pub fn append(
    path: &Path,
    level: LogLevel,
    category: &str,
    event: &str,
    message: &str,
    details: Value,
) -> Result<(), CommandError> {
    if path.metadata().map(|metadata| metadata.len()).unwrap_or(0) >= MAX_LOG_BYTES {
        compact(path)?;
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| CommandError::new("log_write", error.to_string()))?;
    }
    let sequence = LOG_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let entry = RuntimeLogEntry {
        id: format!("log-{}-{sequence}", Utc::now().timestamp_millis()),
        timestamp: Utc::now().to_rfc3339(),
        level,
        category: category.to_owned(),
        event: event.to_owned(),
        message: message.to_owned(),
        details,
    };
    let mut line = serde_json::to_vec(&entry)
        .map_err(|error| CommandError::new("log_serialize", error.to_string()))?;
    line.push(b'\n');
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| file.write_all(&line))
        .map_err(|error| CommandError::new("log_write", error.to_string()))
}

pub fn read(path: &Path) -> Result<Vec<RuntimeLogEntry>, CommandError> {
    let mut entries = read_chronological(path)?;
    if entries.len() > MAX_LOG_ENTRIES {
        entries.drain(..entries.len() - MAX_LOG_ENTRIES);
    }
    entries.reverse();
    Ok(entries)
}

pub fn clear(path: &Path) -> Result<(), CommandError> {
    if !path.exists() {
        return Ok(());
    }
    fs::write(path, []).map_err(|error| CommandError::new("log_clear", error.to_string()))
}

fn compact(path: &Path) -> Result<(), CommandError> {
    let mut entries = read_chronological(path)?;
    if entries.len() > MAX_LOG_ENTRIES / 2 {
        entries.drain(..entries.len() - MAX_LOG_ENTRIES / 2);
    }
    let mut body = Vec::new();
    for entry in entries {
        serde_json::to_writer(&mut body, &entry)
            .map_err(|error| CommandError::new("log_serialize", error.to_string()))?;
        body.push(b'\n');
    }
    fs::write(path, body).map_err(|error| CommandError::new("log_write", error.to_string()))
}

fn read_chronological(path: &Path) -> Result<Vec<RuntimeLogEntry>, CommandError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let body = fs::read_to_string(path)
        .map_err(|error| CommandError::new("log_read", error.to_string()))?;
    Ok(body
        .lines()
        .filter_map(|line| serde_json::from_str::<RuntimeLogEntry>(line).ok())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn reads_newest_logs_first_and_ignores_corrupt_lines() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("runtime.jsonl");
        append(&path, LogLevel::Info, "system", "one", "first", json!({})).unwrap();
        fs::write(
            &path,
            format!("{}invalid\n", fs::read_to_string(&path).unwrap()),
        )
        .unwrap();
        append(&path, LogLevel::Error, "model", "two", "second", json!({})).unwrap();

        let entries = read(&path).unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].event, "two");
        assert_eq!(entries[1].event, "one");
    }

    #[test]
    fn clear_removes_all_entries() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("runtime.jsonl");
        append(&path, LogLevel::Info, "system", "one", "first", json!({})).unwrap();

        clear(&path).unwrap();

        assert!(read(&path).unwrap().is_empty());
    }
}
