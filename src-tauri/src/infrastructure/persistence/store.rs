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

include!("settings.rs");
include!("history.rs");
include!("private_files.rs");
include!("migration.rs");
include!("tests.rs");
