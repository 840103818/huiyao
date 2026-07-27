#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Local, Offset, TimeZone};

    #[test]
    fn production_asset_protocol_is_enabled_by_default() {
        assert!(cfg!(feature = "custom-protocol"));
    }

    #[test]
    fn sanitizes_credentials_and_query_from_logged_base_url() {
        assert_eq!(
            sanitize_base_url("https://user:secret@example.com/v1?token=private#fragment"),
            "https://example.com/v1"
        );
    }

    #[test]
    fn provider_error_details_are_not_written_to_logs() {
        let error = CommandError::new(
            "http_401",
            "provider echoed sk-secret-value and private prompt text",
        );
        assert_eq!(diagnostic_error_message(&error), "模型服务认证或授权失败");
    }

    #[test]
    fn formats_result_time_in_local_time_without_milliseconds() {
        let offset = Local::now().offset().fix();
        let source = offset
            .with_ymd_and_hms(2026, 7, 25, 16, 8, 9)
            .single()
            .expect("valid date")
            .to_rfc3339();
        assert_eq!(format_created_at(&source), "2026-07-25 16:08:09");
        assert_eq!(format_created_at("invalid"), "--");
    }

    #[test]
    fn structured_result_export_has_stable_schema_and_allowlisted_capture_metadata() {
        let result = ReverseResult::default();
        let capture = CaptureMetadata {
            camera_model: Some("Camera X".into()),
            iso: Some("100".into()),
            ..Default::default()
        };
        let body = result_json(&result, Some(&capture)).unwrap();
        let value: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["schemaVersion"], 2);
        assert_eq!(value["kind"], "huiyao.reverse-prompt");
        assert_eq!(value["captureMetadata"]["cameraModel"], "Camera X");
        let serialized = String::from_utf8(body).unwrap();
        assert!(!serialized.to_ascii_lowercase().contains("gps"));
        assert!(!serialized.to_ascii_lowercase().contains("serial"));
    }

    #[test]
    fn workspace_session_ids_are_bounded_and_path_safe() {
        assert_eq!(
            validate_session_id(Some("project-default".into()), "项目标识").unwrap(),
            Some("project-default".into())
        );
        assert_eq!(
            validate_session_id(Some("../settings.json".into()), "项目标识")
                .unwrap_err()
                .code,
            "workspace_session_invalid"
        );
        assert_eq!(
            validate_session_id(Some("x".repeat(129)), "任务标识")
                .unwrap_err()
                .code,
            "workspace_session_invalid"
        );
    }
}
