use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{Read, Write},
    net::{IpAddr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    time::Duration,
};

const MAX_RESPONSE_BYTES: u64 = 256 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionDescriptor {
    session_id: String,
    pid: u32,
    endpoint: String,
    token: String,
    created_at_epoch_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    session_id: String,
    pid: u32,
    created_at_epoch_ms: u128,
}

#[derive(Debug)]
pub struct BridgeError {
    pub code: &'static str,
    pub message: String,
}

impl BridgeError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

fn sessions_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|path| path.join("com.clavierdesk.editor/mcp/sessions"))
    }
    #[cfg(target_os = "macos")]
    {
        env::var_os("HOME").map(PathBuf::from).map(|path| {
            path.join("Library/Application Support/com.clavierdesk.editor/mcp/sessions")
        })
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
            .map(|path| path.join("com.clavierdesk.editor/mcp/sessions"))
    }
}

fn valid_session_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn parse_endpoint(value: &str) -> Option<SocketAddr> {
    let address: SocketAddr = value.strip_prefix("http://")?.parse().ok()?;
    match address.ip() {
        IpAddr::V4(ip) if ip.is_loopback() => Some(address),
        _ => None,
    }
}

fn valid_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn request(address: SocketAddr, token: &str, body: Option<&[u8]>) -> Result<Value, BridgeError> {
    let mut stream =
        TcpStream::connect_timeout(&address, Duration::from_secs(1)).map_err(|error| {
            BridgeError::new(
                "SESSION_NOT_AVAILABLE",
                format!("ClavierDesk is not reachable: {error}"),
            )
        })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(7)))
        .map_err(|error| BridgeError::new("BRIDGE_UNAVAILABLE", error.to_string()))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| BridgeError::new("BRIDGE_UNAVAILABLE", error.to_string()))?;
    let (verb, path) = if body.is_some() {
        ("POST", "/bridge")
    } else {
        ("GET", "/health")
    };
    let header = format!(
        "{verb} {path} HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.map_or(0, |value| value.len())
    );
    stream
        .write_all(header.as_bytes())
        .and_then(|_| match body {
            Some(value) => stream.write_all(value),
            None => Ok(()),
        })
        .map_err(|error| BridgeError::new("BRIDGE_UNAVAILABLE", error.to_string()))?;
    let mut response = Vec::new();
    stream
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut response)
        .map_err(|error| BridgeError::new("BRIDGE_UNAVAILABLE", error.to_string()))?;
    if response.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(BridgeError::new(
            "INVALID_RESPONSE",
            "ClavierDesk response is too large.",
        ));
    }
    let body_start = response
        .windows(4)
        .position(|part| part == b"\r\n\r\n")
        .map(|index| index + 4)
        .ok_or_else(|| {
            BridgeError::new("INVALID_RESPONSE", "ClavierDesk returned invalid HTTP.")
        })?;
    if !response.starts_with(b"HTTP/1.1 200 ") {
        return Err(BridgeError::new(
            "BRIDGE_UNAVAILABLE",
            "ClavierDesk rejected the bridge request.",
        ));
    }
    serde_json::from_slice(&response[body_start..])
        .map_err(|_| BridgeError::new("INVALID_RESPONSE", "ClavierDesk returned invalid JSON."))
}

fn read_valid_descriptor(path: &Path) -> Option<(SessionDescriptor, SocketAddr)> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > 4096 {
        return None;
    }
    let descriptor: SessionDescriptor = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if path.file_stem()?.to_str()? != descriptor.session_id
        || !valid_session_id(&descriptor.session_id)
        || descriptor.pid == 0
        || descriptor.created_at_epoch_ms == 0
        || !valid_token(&descriptor.token)
    {
        return None;
    }
    let address = parse_endpoint(&descriptor.endpoint)?;
    let health = request(address, &descriptor.token, None).ok()?;
    if health.get("ok").and_then(Value::as_bool) != Some(true)
        || health.get("sessionId").and_then(Value::as_str) != Some(descriptor.session_id.as_str())
    {
        return None;
    }
    Some((descriptor, address))
}

pub fn list_sessions() -> Vec<SessionSummary> {
    let Some(directory) = sessions_dir() else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut sessions: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("json"))
        .filter_map(|entry| {
            read_valid_descriptor(&entry.path()).map(|(descriptor, _)| SessionSummary {
                session_id: descriptor.session_id,
                pid: descriptor.pid,
                created_at_epoch_ms: descriptor.created_at_epoch_ms,
            })
        })
        .collect();
    sessions.sort_by(|left, right| right.created_at_epoch_ms.cmp(&left.created_at_epoch_ms));
    sessions
}

pub fn call_session(session_id: &str, method: &str, params: Value) -> Result<Value, BridgeError> {
    if !valid_session_id(session_id) {
        return Err(BridgeError::new(
            "SESSION_NOT_AVAILABLE",
            "Invalid ClavierDesk session ID.",
        ));
    }
    let path = sessions_dir()
        .ok_or_else(|| {
            BridgeError::new("SESSION_NOT_AVAILABLE", "Session directory is unavailable.")
        })?
        .join(format!("{session_id}.json"));
    let (descriptor, address) = read_valid_descriptor(&path).ok_or_else(|| {
        BridgeError::new(
            "SESSION_NOT_AVAILABLE",
            "ClavierDesk session is not available.",
        )
    })?;
    let payload = serde_json::to_vec(&json!({ "method": method, "params": params }))
        .map_err(|error| BridgeError::new("INVALID_REQUEST", error.to_string()))?;
    let response = request(address, &descriptor.token, Some(&payload))?;
    if response.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(response.get("result").cloned().unwrap_or(Value::Null));
    }
    let error = response.get("error");
    Err(BridgeError::new(
        "BRIDGE_ERROR",
        error
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("ClavierDesk could not complete the request."),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{net::TcpListener, thread};

    #[test]
    fn only_local_endpoints_are_accepted() {
        assert!(parse_endpoint("http://127.0.0.1:1234").is_some());
        assert!(parse_endpoint("http://0.0.0.0:1234").is_none());
        assert!(parse_endpoint("http://192.168.1.2:1234").is_none());
        assert!(parse_endpoint("https://127.0.0.1:1234").is_none());
    }

    #[test]
    fn session_ids_cannot_escape_descriptor_directory() {
        assert!(valid_session_id("123e4567-e89b-12d3-a456-426614174000"));
        assert!(!valid_session_id("../../other.json"));
    }

    #[test]
    fn authenticated_loopback_request_reads_bridge_result() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut incoming = Vec::new();
            let mut chunk = [0_u8; 2048];
            while !incoming.ends_with(br#"{"method":"getScoreOverview","params":{}}"#) {
                let count = stream.read(&mut chunk).unwrap();
                assert!(count > 0);
                incoming.extend_from_slice(&chunk[..count]);
            }
            let request_text = String::from_utf8_lossy(&incoming);
            assert!(request_text.starts_with("POST /bridge HTTP/1.1"));
            assert!(request_text.contains("Authorization: Bearer test-token"));
            let body = br#"{"ok":true,"result":{"scoreTrackCount":2,"noteCount":17}}"#;
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(header.as_bytes()).unwrap();
            stream.write_all(body).unwrap();
        });
        let payload = br#"{"method":"getScoreOverview","params":{}}"#;
        let value = request(address, "test-token", Some(payload)).unwrap();
        assert_eq!(value["result"]["noteCount"], 17);
        worker.join().unwrap();
    }
}
