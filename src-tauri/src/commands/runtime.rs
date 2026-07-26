pub(crate) fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            store::ensure_private_dir(&app_data_dir, "app_data")
                .map_err(|error| std::io::Error::other(error.message))?;
            for filename in ["settings.json", "history.json", "runtime.jsonl"] {
                let path = app_data_dir.join(filename);
                if path.exists() {
                    store::set_private_file_permissions(&path, "app_data")
                        .map_err(|error| std::io::Error::other(error.message))?;
                }
            }
            let migration_result = app_data_dir
                .parent()
                .map(|parent| parent.join(LEGACY_IDENTIFIER))
                .filter(|legacy| legacy != &app_data_dir)
                .map(|legacy| store::migrate_legacy_data(&legacy, &app_data_dir));
            let keychain_migration = migrate_legacy_keychain();
            let state = AppState::new(app_data_dir)
                .map_err(|error| std::io::Error::other(error.message))?;
            store::ensure_private_dir(&state.originals_path(), "originals_setup")
                .map_err(|error| std::io::Error::other(error.message))?;
            store::ensure_private_dir(&state.original_staging_path(), "original_staging_setup")
                .map_err(|error| std::io::Error::other(error.message))?;
            let legacy_history = store::read_history(&state.history_path()).unwrap_or_default();
            workspace_store::initialize(&state.workspace_path(), &legacy_history)
                .map_err(|error| std::io::Error::other(error.message))?;
            let _ = workspace_store::pause_active_tasks(&state.workspace_path());
            if let Ok(assets) = workspace_store::purge_expired(&state.workspace_path()) {
                for asset in assets {
                    if let Ok(quarantine) = original_image::quarantine_original(&state.originals_path(), &asset) {
                        let _ = original_image::finalize_quarantined_original(&quarantine);
                    }
                }
            }
            if let Err(error) = original_image::cleanup_staging(
                &state.original_staging_path(),
                Duration::from_secs(24 * 60 * 60),
            ) {
                state.log(
                    LogLevel::Warn,
                    "storage",
                    "original_staging_cleanup_failed",
                    "过期原图暂存清理失败",
                    json!({ "errorCode": error.code }),
                );
            }
            if let Err(error) = original_image::cleanup_quarantined(&state.originals_path()) {
                state.log(
                    LogLevel::Warn,
                    "storage",
                    "original_quarantine_cleanup_failed",
                    "遗留原图隔离文件清理失败",
                    json!({ "errorCode": error.code }),
                );
            }
            match migration_result {
                Some(Ok(count)) if count > 0 => state.log(
                    LogLevel::Info,
                    "storage",
                    "legacy_data_migrated",
                    "旧版应用数据已迁移",
                    json!({ "files": count }),
                ),
                Some(Err(error)) => state.log(
                    LogLevel::Warn,
                    "storage",
                    "legacy_data_migration_failed",
                    "旧版应用数据迁移未完成",
                    json!({ "errorCode": error.code }),
                ),
                _ => {}
            }
            match keychain_migration {
                Ok(true) => state.log(
                    LogLevel::Info,
                    "storage",
                    "legacy_keychain_migrated",
                    "旧版钥匙串凭证已迁移",
                    json!({}),
                ),
                Err(error) => state.log(
                    LogLevel::Warn,
                    "storage",
                    "legacy_keychain_migration_failed",
                    "旧版钥匙串凭证迁移未完成",
                    json!({ "errorCode": error.code }),
                ),
                _ => {}
            }
            state.log(
                LogLevel::Info,
                "system",
                "app_started",
                "应用已启动",
                json!({ "version": env!("CARGO_PKG_VERSION"), "platform": "macOS" }),
            );
            app.manage(state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                let state = window.state::<AppState>();
                if let Ok(_guard) = state.storage_lock.lock() {
                    let _ = workspace_store::pause_active_tasks(&state.workspace_path());
                }
                let cancelled = state.cancel_all_requests();
                if cancelled > 0 {
                    state.log(
                        LogLevel::Warn,
                        "model",
                        "window_requests_cancelled",
                        "窗口关闭，已取消进行中的模型请求",
                        json!({ "count": cancelled }),
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            save_theme,
            save_workspace_preferences,
            test_connection,
            reverse_prompt_stream,
            optimize_prompt_stream,
            cancel_reverse_prompt,
            stage_original_image,
            discard_original_stage,
            load_history,
            save_history,
            load_original_image,
            export_original_image,
            get_original_storage_stats,
            remove_history_original,
            clear_original_images,
            export_result,
            export_runtime_logs,
            export_diagnostic,
            load_runtime_logs,
            clear_runtime_logs,
            list_projects,
            create_project,
            rename_project,
            delete_project,
            list_project_tasks,
            get_project_task,
            import_project_task,
            update_project_task_status,
            complete_project_task,
            fail_project_task,
            set_project_task_favorite,
            set_project_task_tags,
            move_project_tasks,
            reorder_project_tasks,
            duplicate_project_task,
            delete_project_tasks,
            get_batch_progress,
            list_reverse_presets,
            save_reverse_preset,
            delete_reverse_preset,
            list_trash,
            restore_trash_entry,
            permanently_delete_trash_entry,
            empty_trash,
            load_workspace_original_image,
            export_workspace_original_image,
            export_project_tasks,
            save_workspace_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running 绘钥");
}

fn sanitize_base_url(value: &str) -> String {
    let Ok(mut url) = reqwest::Url::parse(value) else {
        return "(invalid)".into();
    };
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    url.to_string().trim_end_matches('/').to_owned()
}

fn diagnostic_error_message(error: &CommandError) -> &'static str {
    match error.code.as_str() {
        "missing_api_key" => "未配置 API Key",
        "missing_model" => "未配置模型名称",
        "invalid_base_url" => "Base URL 配置无效",
        "insecure_http_confirmation_required" => "非本机 HTTP 地址尚未确认风险",
        "redirect_blocked" => "模型服务返回重定向，已阻止凭证转发",
        "missing_image" => "图片输入缺失",
        "invalid_image" => "图片数据无效",
        "image_too_large" | "image_dimensions_too_large" => "图片超过安全限制",
        "requirements_too_long" => "补充要求超过安全限制",
        "response_too_large" => "模型响应超过安全限制",
        "timeout" => "模型请求超时",
        "network" | "client_error" | "response_read" => "模型服务网络请求失败",
        "http_401" | "http_403" => "模型服务认证或授权失败",
        "http_404" => "模型接口或模型不存在",
        "http_413" => "模型请求载荷过大",
        "http_429" => "模型服务限流或额度不足",
        code if code.starts_with("http_5") => "模型服务内部错误",
        code if code.starts_with("http_") => "模型服务返回异常状态",
        "empty_response" => "模型未返回可用内容",
        "invalid_response" => "模型服务响应格式无效",
        "invalid_model_json" => "模型输出无法解析为结构化结果",
        "invalid_stream" | "stream_error" | "stream_interrupted" => "模型流式响应异常",
        "cancelled" => "生成已停止",
        _ => "操作失败，请结合错误码排查",
    }
}

fn output_language_name(value: models::OutputLanguage) -> &'static str {
    match value {
        models::OutputLanguage::Chinese => "chinese",
        models::OutputLanguage::English => "english",
        models::OutputLanguage::Bilingual => "bilingual",
    }
}

fn detail_level_name(value: models::DetailLevel) -> &'static str {
    match value {
        models::DetailLevel::Concise => "concise",
        models::DetailLevel::Standard => "standard",
        models::DetailLevel::Detailed => "detailed",
        models::DetailLevel::Expert => "expert",
    }
}

fn optimization_target_name(value: PromptOptimizationTarget) -> &'static str {
    match value {
        PromptOptimizationTarget::General => "general",
        PromptOptimizationTarget::Midjourney => "midjourney",
        PromptOptimizationTarget::Flux => "flux",
        PromptOptimizationTarget::Sdxl => "sdxl",
    }
}
