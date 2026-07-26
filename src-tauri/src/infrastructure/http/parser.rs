fn parse_result(content: &str) -> Result<ReverseResult, CommandError> {
    parse_json_object(content)
}

fn parse_json_object<T: serde::de::DeserializeOwned>(content: &str) -> Result<T, CommandError> {
    let trimmed = content.trim();
    let without_prefix = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed);
    let without_fence = without_prefix
        .strip_suffix("```")
        .unwrap_or(without_prefix)
        .trim();
    let json_slice = match (without_fence.find('{'), without_fence.rfind('}')) {
        (Some(start), Some(end)) if start <= end => &without_fence[start..=end],
        _ => {
            return Err(CommandError::new(
                "invalid_model_json",
                "模型未返回结构化结果，请重试或更换兼容模型",
            ))
        }
    };
    serde_json::from_str(json_slice).map_err(|_| {
        CommandError::new(
            "invalid_model_json",
            "模型返回的 JSON 不完整，请重试或降低详细程度",
        )
    })
}

fn empty_as_none(value: &str) -> &str {
    if value.trim().is_empty() {
        "无"
    } else {
        value.trim()
    }
}

