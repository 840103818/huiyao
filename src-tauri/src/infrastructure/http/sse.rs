#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
}

impl SseDecoder {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, CommandError> {
        if self.buffer.len().saturating_add(bytes.len()) > MAX_SSE_BUFFER_BYTES {
            return Err(response_too_large_error());
        }
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some((index, separator_len)) = find_event_separator(&self.buffer) {
            let event = self.buffer.drain(..index).collect::<Vec<_>>();
            self.buffer.drain(..separator_len);
            if let Some(data) = decode_sse_event(&event)? {
                events.push(data);
            }
        }
        Ok(events)
    }

    fn finish(&mut self) -> Result<Vec<String>, CommandError> {
        if self.buffer.is_empty() {
            return Ok(Vec::new());
        }
        let remaining = std::mem::take(&mut self.buffer);
        Ok(decode_sse_event(&remaining)?.into_iter().collect())
    }
}

fn find_event_separator(bytes: &[u8]) -> Option<(usize, usize)> {
    let crlf = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| (index, 4));
    let lf = bytes
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|index| (index, 2));
    match (crlf, lf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn decode_sse_event(bytes: &[u8]) -> Result<Option<String>, CommandError> {
    let event = std::str::from_utf8(bytes)
        .map_err(|_| CommandError::new("invalid_stream", "流式响应包含无效 UTF-8 数据"))?;
    let data = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.strip_prefix(' ').unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n");
    Ok((!data.is_empty()).then_some(data))
}

