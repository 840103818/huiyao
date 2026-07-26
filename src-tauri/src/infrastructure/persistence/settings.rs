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

