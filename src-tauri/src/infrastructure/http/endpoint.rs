pub fn endpoint_from_base_url(base_url: &str) -> Result<String, CommandError> {
    let mut url = parse_base_url(base_url)?;
    let path = url.path().trim_end_matches('/');
    if !path.ends_with("/chat/completions") {
        url.set_path(&format!("{path}/chat/completions"));
    }
    Ok(url.to_string())
}

pub fn insecure_http_origin(base_url: &str) -> Result<Option<String>, CommandError> {
    let url = parse_base_url(base_url)?;
    if url.scheme() != "http" || is_loopback_host(url.host_str()) {
        return Ok(None);
    }
    Ok(Some(url.origin().ascii_serialization()))
}

pub fn validate_base_url_security(
    base_url: &str,
    acknowledged_origin: Option<&str>,
) -> Result<(), CommandError> {
    if let Some(origin) = insecure_http_origin(base_url)? {
        if acknowledged_origin != Some(origin.as_str()) {
            return Err(CommandError::new(
                "insecure_http_confirmation_required",
                "该模型服务使用明文 HTTP，请确认 API Key 可能被网络监听",
            ));
        }
    }
    Ok(())
}

fn parse_base_url(base_url: &str) -> Result<Url, CommandError> {
    let normalized = base_url.trim();
    if normalized.is_empty() || normalized.chars().count() > MAX_BASE_URL_CHARS {
        return Err(CommandError::new(
            "invalid_base_url",
            "Base URL 为空或长度超过限制",
        ));
    }
    let mut url = Url::parse(normalized)
        .map_err(|_| CommandError::new("invalid_base_url", "Base URL 必须是有效的 HTTP(S) 地址"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(CommandError::new(
            "invalid_base_url",
            "Base URL 必须是有效的 HTTP(S) 地址",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err(CommandError::new(
            "invalid_base_url",
            "Base URL 不能包含用户名、密码或片段",
        ));
    }
    url.set_fragment(None);
    Ok(url)
}

fn is_loopback_host(host: Option<&str>) -> bool {
    matches!(host, Some("localhost"))
        || host
            .and_then(|value| value.parse::<std::net::IpAddr>().ok())
            .is_some_and(|address| address.is_loopback())
}

