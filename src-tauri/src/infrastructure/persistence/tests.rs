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
