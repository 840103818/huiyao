#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Analysis, DetailLevel, OutputLanguage, Prompts, ThemeMode};
    use httpmock::prelude::*;

    fn settings(base_url: String) -> SettingsFile {
        SettingsFile {
            base_url,
            model: "vision-test".into(),
            timeout_seconds: 10,
            theme: ThemeMode::System,
            auto_save_history: true,
            insecure_http_origin: None,
            workspace: Default::default(),
        }
    }

    fn image_request() -> ReverseRequest {
        ReverseRequest {
            image_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=".into(),
            requirements: String::new(),
            output_language: OutputLanguage::Bilingual,
            detail_level: DetailLevel::Standard,
        }
    }

    fn optimization_request(target: PromptOptimizationTarget) -> PromptOptimizationRequest {
        PromptOptimizationRequest {
            analysis: Analysis {
                subject: "产品静物".into(),
                lighting: "左侧柔光".into(),
                ..Default::default()
            },
            source_prompts: Prompts {
                zh: "产品摄影".into(),
                en: "product photography".into(),
            },
            source_negative_prompts: None,
            target,
            requirements: "保持真实材质".into(),
            aspect_ratio: Some("3:2".into()),
        }
    }

    #[test]
    fn endpoint_normalizes_base_url() {
        assert_eq!(
            endpoint_from_base_url("https://api.example.com/v1/").unwrap(),
            "https://api.example.com/v1/chat/completions"
        );
        assert!(endpoint_from_base_url("api.example.com").is_err());
        assert!(endpoint_from_base_url("https://user:pass@example.com/v1").is_err());
        assert!(endpoint_from_base_url("https://example.com/v1#fragment").is_err());
    }

    #[test]
    fn insecure_http_requires_exact_origin_confirmation() {
        let base_url = "http://api.example.com:8080/v1";
        assert_eq!(
            validate_base_url_security(base_url, None).unwrap_err().code,
            "insecure_http_confirmation_required"
        );
        assert!(validate_base_url_security(base_url, Some("http://api.example.com:8080")).is_ok());
        assert!(validate_base_url_security("http://127.0.0.1:8080/v1", None).is_ok());
    }

    #[test]
    fn invalid_image_payload_is_rejected_before_request() {
        let mut request = image_request();
        request.image_data_url = "data:image/png;base64,aGVsbG8=".into();
        assert_eq!(build_messages(&request).unwrap_err().code, "invalid_image");
    }

    #[test]
    fn parses_fenced_model_json() {
        let content = r#"```json
        {"analysis":{"subject":"watch","scene":"studio","tonality":"low key","postProcessing":"cool grade"},"prompts":{"zh":"中文","en":"English"}}
        ```"#;
        let result = parse_result(content).unwrap();
        assert_eq!(result.analysis.subject, "watch");
        assert_eq!(result.analysis.scene, "studio");
        assert_eq!(result.analysis.tonality, "low key");
        assert_eq!(result.analysis.post_processing, "cool grade");
        assert_eq!(result.prompts.en, "English");
    }

    #[test]
    fn photography_analysis_prompt_covers_reproducible_visual_dimensions() {
        for field in ["scene", "tonality", "postProcessing"] {
            assert!(SYSTEM_PROMPT.contains(&format!("\"{field}\"")));
        }
        assert!(SYSTEM_PROMPT.contains("无法确认的摄影特征"));
        assert!(SYSTEM_PROMPT.contains("相机型号"));
    }

    #[test]
    fn image_mode_rejects_empty_input() {
        let mut request = image_request();
        request.image_data_url.clear();
        assert_eq!(build_messages(&request).unwrap_err().code, "missing_image");
    }

    #[test]
    fn optimization_messages_are_text_only_and_target_specific() {
        let messages = build_optimization_messages(&optimization_request(
            PromptOptimizationTarget::Midjourney,
        ))
        .unwrap();
        let body = serde_json::to_string(&messages).unwrap();
        assert!(!body.contains("image_url"));
        assert!(body.contains("Midjourney"));
        assert!(body.contains("3:2"));

        let sdxl =
            build_optimization_messages(&optimization_request(PromptOptimizationTarget::Sdxl))
                .unwrap();
        assert!(serde_json::to_string(&sdxl).unwrap().contains("负面提示词"));
    }

    #[tokio::test]
    async fn streams_bilingual_optimization_without_resending_an_image() {
        let server = MockServer::start();
        let completion = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_excludes("image_url")
                .body_includes("midjourney")
                .body_includes("\"stream\":true");
            then.status(200)
                .header("content-type", "text/event-stream")
                .body(concat!(
                    "data: {\"model\":\"vision-test\",\"choices\":[{\"delta\":{\"content\":\"{\\\"prompts\\\":{\\\"zh\\\":\\\"优化中文\\\",\"}}]}\n\n",
                    "data: {\"choices\":[{\"delta\":{\"content\":\"\\\"en\\\":\\\"optimized English\\\"},\\\"negativePrompts\\\":{\\\"zh\\\":\\\"\\\",\\\"en\\\":\\\"\\\"}}\"}}]}\n\n",
                    "data: {\"choices\":[],\"usage\":{\"total_tokens\":23}}\n\n",
                    "data: [DONE]\n\n"
                ));
        });
        let mut deltas = Vec::new();
        let outcome = optimize_prompt_stream(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-secret",
            &optimization_request(PromptOptimizationTarget::Midjourney),
            &CancellationToken::new(),
            |event| {
                if let ApiStreamEvent::Delta(value) = event {
                    deltas.push(value);
                }
            },
        )
        .await
        .unwrap();

        completion.assert();
        assert_eq!(outcome.result.prompts.zh, "优化中文");
        assert_eq!(outcome.result.prompts.en, "optimized English");
        assert_eq!(outcome.result.metadata.total_tokens, Some(23));
        assert_eq!(deltas.len(), 2);
    }

    #[test]
    fn sse_decoder_handles_chunk_boundaries_crlf_and_utf8() {
        let payload =
            "data: {\"choices\":[{\"delta\":{\"content\":\"中文\"}}]}\r\n\r\ndata: [DONE]\n\n";
        let bytes = payload.as_bytes();
        let split = payload.find('文').unwrap() + 1;
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(&bytes[..split]).unwrap().is_empty());
        let events = decoder.push(&bytes[split..]).unwrap();
        assert_eq!(events.len(), 2);
        assert!(events[0].contains("中文"));
        assert_eq!(events[1], "[DONE]");
    }

    #[tokio::test]
    async fn streams_authorized_completion_and_usage() {
        let server = MockServer::start();
        let completion = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .header("authorization", "Bearer test-secret")
                .body_includes("\"stream\":true");
            then.status(200)
                .header("content-type", "text/event-stream")
                .header("x-request-id", "provider-stream-42")
                .body(concat!(
                    "data: {\"model\":\"vision-test\",\"choices\":[{\"delta\":{\"content\":\"{\\\"analysis\\\":{\\\"subject\\\":\\\"sample\\\"},\"}}]}\n\n",
                    "data: {\"choices\":[{\"delta\":{\"content\":\"\\\"prompts\\\":{\\\"zh\\\":\\\"中文\\\",\\\"en\\\":\\\"English\\\"}}\"}}]}\n\n",
                    "data: {\"choices\":[],\"usage\":{\"total_tokens\":42}}\n\n",
                    "data: [DONE]\n\n"
                ));
        });
        let mut deltas = Vec::new();
        let outcome = reverse_prompt_stream(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-secret",
            &image_request(),
            &CancellationToken::new(),
            |event| {
                if let ApiStreamEvent::Delta(value) = event {
                    deltas.push(value);
                }
            },
        )
        .await
        .unwrap();

        completion.assert();
        assert_eq!(outcome.result.analysis.subject, "sample");
        assert_eq!(outcome.result.metadata.total_tokens, Some(42));
        assert_eq!(
            outcome.result.metadata.provider_request_id.as_deref(),
            Some("provider-stream-42")
        );
        assert_eq!(deltas.len(), 2);
        assert!(!outcome.used_fallback);
    }

    #[tokio::test]
    async fn retries_stream_without_options_then_falls_back_to_json() {
        let server = MockServer::start();
        let with_options = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_includes("\"stream_options\"");
            then.status(400);
        });
        let plain_stream = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_includes("\"stream\":true")
                .body_excludes("\"stream_options\"");
            then.status(415);
        });
        let ordinary = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_excludes("\"stream\"");
            then.status(200)
                .header("content-type", "application/json")
                .json_body(json!({
                    "model": "vision-fallback",
                    "choices": [{ "message": { "content": "{\"analysis\":{\"subject\":\"fallback\"},\"prompts\":{\"zh\":\"中文\",\"en\":\"English\"}}" } }],
                    "usage": { "total_tokens": 17 }
                }));
        });
        let mut fallback_events = 0;
        let outcome = reverse_prompt_stream(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-secret",
            &image_request(),
            &CancellationToken::new(),
            |event| {
                if matches!(event, ApiStreamEvent::Fallback) {
                    fallback_events += 1;
                }
            },
        )
        .await
        .unwrap();

        with_options.assert_calls(1);
        plain_stream.assert_calls(1);
        ordinary.assert_calls(1);
        assert_eq!(fallback_events, 1);
        assert!(outcome.used_fallback);
        assert_eq!(outcome.result.analysis.subject, "fallback");
        assert_eq!(outcome.result.metadata.total_tokens, Some(17));
    }

    #[tokio::test]
    async fn cancellation_interrupts_a_pending_request() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let pending = async { std::future::pending::<Result<Response, reqwest::Error>>().await };

        let error = select_response(pending, &cancellation).await.unwrap_err();

        assert_eq!(error.code, "cancelled");
    }

    #[tokio::test]
    async fn reports_stream_ending_without_done_as_interrupted() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_includes("\"stream\":true");
            then.status(200)
                .header("content-type", "text/event-stream")
                .body("data: {\"choices\":[{\"delta\":{\"content\":\"{}\"}}]}\n\n");
        });

        let error = reverse_prompt_stream(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-secret",
            &image_request(),
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .err()
        .expect("stream without DONE must fail");

        assert_eq!(error.code, "stream_interrupted");
    }

    #[test]
    fn sse_decoder_uses_the_earliest_mixed_line_separator() {
        let mut decoder = SseDecoder::default();
        let events = decoder
            .push(b"data: first\n\ndata: second\r\n\r\n")
            .unwrap();

        assert_eq!(events, vec!["first", "second"]);
    }

    #[tokio::test]
    async fn maps_unauthorized_response_without_fallback() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/v1/chat/completions");
            then.status(401)
                .json_body(json!({ "error": { "message": "invalid key" } }));
        });
        let error = test_connection(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "bad-key",
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "http_401");
        assert_eq!(error.message, "API Key 无效或没有访问该模型的权限");
        assert!(error
            .diagnostic_payload
            .as_deref()
            .is_some_and(|value| value.contains("invalid key")));
    }

    #[tokio::test]
    async fn maps_rate_limit_response_without_fallback() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(POST).path("/v1/chat/completions");
            then.status(429)
                .json_body(json!({ "error": { "message": "quota exceeded" } }));
        });

        let error = test_connection(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-key",
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, "http_429");
        assert_eq!(error.message, "请求过于频繁或额度不足，请稍后重试");
        request.assert_calls(1);
    }

    #[test]
    fn rejects_stream_content_over_the_limit() {
        let data = json!({
            "choices": [{ "delta": { "content": "x".repeat(MAX_STREAM_CONTENT_BYTES + 1) } }]
        })
        .to_string();
        let mut content = String::new();
        let mut response_model = String::new();
        let mut usage = None;
        let mut first_token_ms = None;

        let error = consume_stream_data(
            &data,
            Instant::now(),
            &mut content,
            &mut response_model,
            &mut usage,
            &mut first_token_ms,
            &mut |_| {},
        )
        .unwrap_err();

        assert_eq!(error.code, "response_too_large");
        assert!(content.is_empty());
    }

    #[tokio::test]
    async fn blocks_cross_origin_redirects_without_forwarding_credentials() {
        let server = MockServer::start();
        let redirect = server.mock(|when, then| {
            when.method(POST).path("/v1/chat/completions");
            then.status(307)
                .header("location", "https://unexpected.example/v1/chat/completions");
        });

        let error = test_connection(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "secret-key",
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, "redirect_blocked");
        assert_eq!(redirect.calls(), 1);
    }

    #[tokio::test]
    async fn rejects_an_oversized_non_streaming_response() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/v1/chat/completions");
            then.status(200)
                .header("content-type", "application/json")
                .body("x".repeat(MAX_RESPONSE_BYTES + 1));
        });

        let error = test_connection(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "secret-key",
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, "response_too_large");
    }

    #[tokio::test]
    async fn connection_test_uses_the_streaming_transport() {
        let server = MockServer::start();
        let completion = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .header("authorization", "Bearer test-secret")
                .body_includes("\"stream\":true");
            then.status(200)
                .header("content-type", "text/event-stream")
                .header("x-request-id", "provider-probe-42")
                .body(concat!(
                    "data: {\"model\":\"vision-stream\",\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\n",
                    "data: [DONE]\n\n"
                ));
        });

        let status = test_connection(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-secret",
        )
        .await
        .unwrap();

        completion.assert_calls(1);
        assert_eq!(status.model, "vision-stream");
        assert_eq!(
            status.provider_request_id.as_deref(),
            Some("provider-probe-42")
        );
    }

    #[tokio::test]
    async fn connection_test_falls_back_when_streaming_is_unsupported() {
        let server = MockServer::start();
        let streaming = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_includes("\"stream\":true");
            then.status(422);
        });
        let ordinary = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_excludes("\"stream\"");
            then.status(200)
                .header("content-type", "application/json")
                .json_body(json!({
                    "model": "vision-fallback",
                    "choices": [{ "message": { "content": "OK" } }]
                }));
        });

        let status = test_connection(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-secret",
        )
        .await
        .unwrap();

        streaming.assert_calls(1);
        ordinary.assert_calls(1);
        assert_eq!(status.model, "vision-fallback");
    }

    #[test]
    fn stream_fallback_statuses_are_explicit() {
        assert!(is_stream_compatibility_status(StatusCode::BAD_REQUEST));
        assert!(is_stream_compatibility_status(
            StatusCode::UNPROCESSABLE_ENTITY
        ));
        assert!(!is_stream_compatibility_status(StatusCode::UNAUTHORIZED));
        assert!(!is_stream_compatibility_status(
            StatusCode::TOO_MANY_REQUESTS
        ));
    }

    #[test]
    fn parse_error_preserves_raw_model_response() {
        let raw = "not json";
        let error = parse_result(raw)
            .map_err(|error| error.with_diagnostic_payload(raw))
            .unwrap_err();
        assert_eq!(error.diagnostic_payload.as_deref(), Some(raw));
    }
}
