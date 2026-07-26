use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use chrono::Utc;
use serde::Serialize;

use crate::models::CommandError;

const MAX_ENTRIES: usize = 5;
const MAX_AGE: Duration = Duration::from_secs(30 * 60);
const MAX_PAYLOAD_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEntry {
    pub id: String,
    pub created_at: String,
    pub interaction_id: String,
    pub error_code: String,
    pub error_message: String,
    pub provider_request_id: Option<String>,
    pub response: String,
    #[serde(skip)]
    created: Instant,
}

#[derive(Default)]
pub struct DiagnosticCache {
    entries: HashMap<String, DiagnosticEntry>,
}

impl DiagnosticCache {
    pub fn insert(&mut self, interaction_id: &str, error: &CommandError) -> Option<String> {
        let payload = error.diagnostic_payload.as_deref()?;
        self.prune();
        if self.entries.len() >= MAX_ENTRIES {
            if let Some(oldest) = self
                .entries
                .values()
                .min_by_key(|entry| entry.created)
                .map(|entry| entry.id.clone())
            {
                self.entries.remove(&oldest);
            }
        }
        let id = format!(
            "diag-{}-{}",
            Utc::now().timestamp_millis(),
            self.entries.len() + 1
        );
        self.entries.insert(
            id.clone(),
            DiagnosticEntry {
                id: id.clone(),
                created_at: Utc::now().to_rfc3339(),
                interaction_id: interaction_id.to_owned(),
                error_code: error.code.clone(),
                error_message: sanitize_text(&error.message, 2_000),
                provider_request_id: error
                    .provider_request_id
                    .as_deref()
                    .map(|value| sanitize_text(value, 256)),
                response: sanitize_text(payload, MAX_PAYLOAD_BYTES),
                created: Instant::now(),
            },
        );
        Some(id)
    }

    pub fn get(&mut self, id: &str) -> Option<DiagnosticEntry> {
        self.prune();
        self.entries.get(id).cloned()
    }

    fn prune(&mut self) {
        self.entries
            .retain(|_, entry| entry.created.elapsed() <= MAX_AGE);
    }
}

pub fn sanitize_text(value: &str, max_bytes: usize) -> String {
    let truncated = truncate_utf8(value, max_bytes);
    let mut redacted = redact_data_urls(truncated);
    for prefix in [
        "sk-",
        "Bearer ",
        "bearer ",
        "api_key=",
        "apiKey=",
        "access_token=",
        "\"apiKey\":\"",
        "\"api_key\":\"",
        "\"access_token\":\"",
        "\"authorization\":\"",
    ] {
        redacted = redact_prefixed_secret(&redacted, prefix);
    }
    truncate_utf8(&redacted, max_bytes).to_owned()
}

fn redact_data_urls(value: &str) -> String {
    redact_until_delimiter(value, "data:image/", "[图片数据已移除]")
}

fn redact_prefixed_secret(value: &str, prefix: &str) -> String {
    redact_until_delimiter(value, prefix, "[凭证已移除]")
}

fn redact_until_delimiter(value: &str, needle: &str, replacement: &str) -> String {
    let mut output = String::with_capacity(value.len().min(MAX_PAYLOAD_BYTES));
    let mut rest = value;
    while let Some(index) = rest.find(needle) {
        output.push_str(&rest[..index]);
        output.push_str(replacement);
        let sensitive = &rest[index + needle.len()..];
        let end = sensitive
            .char_indices()
            .find_map(|(position, character)| {
                (character.is_whitespace() || matches!(character, '"' | '\'' | '\\' | '<' | '>'))
                    .then_some(position)
            })
            .unwrap_or(sensitive.len());
        rest = &sensitive[end..];
    }
    output.push_str(rest);
    output
}

fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_payload_is_redacted_and_bounded() {
        let value = format!(
            "before data:image/png;base64,AAAA\" middle sk-secret-value after {}",
            "文".repeat(MAX_PAYLOAD_BYTES)
        );
        let sanitized = sanitize_text(&value, MAX_PAYLOAD_BYTES);
        assert!(!sanitized.contains("AAAA"));
        assert!(!sanitized.contains("secret-value"));
        assert!(sanitized.len() <= MAX_PAYLOAD_BYTES);
    }

    #[test]
    fn diagnostic_payload_redacts_common_authorization_shapes() {
        let sanitized = sanitize_text(
            "Authorization: Bearer private-token \"apiKey\":\"hidden-key\" access_token=query-secret",
            4_096,
        );
        assert!(!sanitized.contains("private-token"));
        assert!(!sanitized.contains("hidden-key"));
        assert!(!sanitized.contains("query-secret"));
    }

    #[test]
    fn cache_only_exposes_sanitized_entries() {
        let error = CommandError::new("invalid", "failed")
            .with_diagnostic_payload("data:image/jpeg;base64,PRIVATE\"");
        let mut cache = DiagnosticCache::default();
        let id = cache.insert("req-1", &error).unwrap();
        let entry = cache.get(&id).unwrap();
        assert_eq!(entry.interaction_id, "req-1");
        assert!(!entry.response.contains("PRIVATE"));
    }
}
