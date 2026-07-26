#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<PublicSettings, CommandError> {
    let settings = store::read_settings(&state.settings_path())?;
    let has_api_key = !read_api_key()?.is_empty();
    Ok(public_settings(settings, has_api_key))
}

#[tauri::command]
fn save_settings(
    state: State<'_, AppState>,
    input: SettingsInput,
) -> Result<PublicSettings, CommandError> {
    let _guard = state
        .settings_lock
        .lock()
        .map_err(|_| CommandError::new("settings_lock", "设置暂时不可用"))?;
    let previous_settings = store::read_settings(&state.settings_path())?;
    let mut settings = previous_settings.clone();
    settings.apply_input(&input);
    api::endpoint_from_base_url(&settings.base_url)?;
    let required_insecure_origin = api::insecure_http_origin(&settings.base_url)?;
    api::validate_base_url_security(&settings.base_url, input.insecure_http_origin.as_deref())?;
    settings.insecure_http_origin = required_insecure_origin;
    if settings.model.is_empty() || settings.model.chars().count() > 200 {
        return Err(CommandError::new("missing_model", "请填写模型名称"));
    }
    let previous_key = read_api_key()?;
    if input
        .api_key
        .as_deref()
        .is_some_and(|value| value.chars().count() > 4_096)
    {
        return Err(CommandError::new(
            "api_key_too_long",
            "API Key 长度超过限制",
        ));
    }
    let key_update = if input.clear_api_key {
        Some(None)
    } else {
        input
            .api_key
            .as_deref()
            .filter(|key| !key.trim().is_empty())
            .map(|key| Some(key.trim().to_owned()))
    };
    if let Some(value) = key_update.as_ref() {
        write_api_key(value.as_deref())?;
    }
    if let Err(error) = store::write_settings(&state.settings_path(), &settings) {
        if key_update.is_some() {
            let rollback = (!previous_key.is_empty()).then_some(previous_key.as_str());
            if write_api_key(rollback).is_err() {
                return Err(CommandError::new(
                    "settings_transaction_failed",
                    "设置保存失败，且钥匙串回滚未完成，请重新检查配置",
                ));
            }
        }
        return Err(error);
    }
    let has_api_key = key_update
        .as_ref()
        .map(|value| value.is_some())
        .unwrap_or(!previous_key.is_empty());
    let public = public_settings(settings, has_api_key);
    state.log(
        LogLevel::Info,
        "system",
        "settings_saved",
        "模型服务设置已保存",
        json!({
            "baseUrl": sanitize_base_url(&public.base_url),
            "model": public.model,
            "timeoutSeconds": public.timeout_seconds,
            "theme": public.theme,
            "hasApiKey": public.has_api_key,
        }),
    );
    Ok(public)
}

#[tauri::command]
fn save_theme(
    state: State<'_, AppState>,
    theme: ThemeMode,
) -> Result<PublicSettings, CommandError> {
    let _guard = state
        .settings_lock
        .lock()
        .map_err(|_| CommandError::new("settings_lock", "设置暂时不可用"))?;
    let mut settings = store::read_settings(&state.settings_path())?;
    settings.theme = theme;
    store::write_settings(&state.settings_path(), &settings)?;
    let public = public_settings(settings, !read_api_key()?.is_empty());
    state.log(
        LogLevel::Info,
        "system",
        "theme_saved",
        "外观主题已切换",
        json!({ "theme": public.theme }),
    );
    Ok(public)
}

#[tauri::command]
fn save_workspace_preferences(
    state: State<'_, AppState>,
    preferences: WorkspacePreferences,
) -> Result<PublicSettings, CommandError> {
    let _guard = state
        .settings_lock
        .lock()
        .map_err(|_| CommandError::new("settings_lock", "设置暂时不可用"))?;
    let mut settings = store::read_settings(&state.settings_path())?;
    settings.workspace = preferences.normalized();
    store::write_settings(&state.settings_path(), &settings)?;
    Ok(public_settings(settings, !read_api_key()?.is_empty()))
}

