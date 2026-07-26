fn map_network_error(error: reqwest::Error) -> CommandError {
    if error.is_timeout() {
        CommandError::new("timeout", "请求超时，请检查网络或提高超时时间")
    } else if error.is_connect() {
        CommandError::new("network", "无法连接到模型服务，请检查 Base URL 和网络")
    } else {
        CommandError::new("network", error.to_string())
    }
}

fn map_response_read_error(_error: reqwest::Error) -> CommandError {
    CommandError::new(
        "response_read",
        "模型服务在返回响应时中断，请重试；如反复出现，请检查服务商网关",
    )
}

fn response_too_large_error() -> CommandError {
    CommandError::new(
        "response_too_large",
        "模型响应超过安全限制，请降低详细程度或更换模型",
    )
}

fn map_http_error(status: StatusCode, body: &str) -> CommandError {
    let fallback = match status.as_u16() {
        300..=399 => "模型服务返回重定向；为保护 API Key，请直接填写最终 Base URL",
        401 | 403 => "API Key 无效或没有访问该模型的权限",
        404 => "接口或模型不存在，请检查 Base URL 和模型名称",
        413 => "图片过大，请缩小输入后重试",
        429 => "请求过于频繁或额度不足，请稍后重试",
        500..=599 => "模型服务暂时不可用，请稍后重试",
        _ => "模型服务返回错误",
    };
    CommandError::new(
        if status.is_redirection() {
            "redirect_blocked".into()
        } else {
            format!("http_{}", status.as_u16())
        },
        fallback,
    )
    .with_diagnostic_payload(body)
}

