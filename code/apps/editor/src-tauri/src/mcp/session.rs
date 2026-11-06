use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use super::{bridge::PendingResponses, server};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStartResult {
    session_id: String,
    endpoint: String,
    pid: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionDescriptor {
    session_id: String,
    pid: u32,
    endpoint: String,
    token: String,
    created_at_epoch_ms: u128,
}

struct ActiveSession {
    descriptor_path: PathBuf,
    address: SocketAddr,
    token: String,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl ActiveSession {
    fn shutdown(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        let _ = fs::remove_file(&self.descriptor_path);
    }
}

impl Drop for ActiveSession {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = fs::remove_file(&self.descriptor_path);
    }
}

pub struct McpSessions {
    active: Mutex<Option<ActiveSession>>,
    pending: Arc<PendingResponses>,
}

impl Default for McpSessions {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            pending: Arc::new(Mutex::new(Default::default())),
        }
    }
}

impl McpSessions {
    pub(super) fn pending(&self) -> &PendingResponses {
        &self.pending
    }
}

fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("mcp/sessions"))
        .map_err(|error| error.to_string())
}

fn write_descriptor(path: &PathBuf, descriptor: &SessionDescriptor) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid MCP session path.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let source = serde_json::to_vec_pretty(descriptor).map_err(|error| error.to_string())?;
    fs::write(&temporary, source).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn mcp_start_session(
    app: AppHandle,
    sessions: State<'_, McpSessions>,
) -> Result<McpStartResult, String> {
    let mut active = sessions
        .active
        .lock()
        .map_err(|_| "MCP session state is unavailable.".to_string())?;
    if active.is_some() {
        return Err("An MCP session is already running.".to_string());
    }

    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
        .map_err(|error| format!("Could not start the MCP internal bridge: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let endpoint = format!(
        "http://{}",
        listener.local_addr().map_err(|error| error.to_string())?
    );
    let address = listener.local_addr().map_err(|error| error.to_string())?;
    let session_id = Uuid::new_v4().to_string();
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let descriptor = SessionDescriptor {
        session_id: session_id.clone(),
        pid: std::process::id(),
        endpoint: endpoint.clone(),
        token: token.clone(),
        created_at_epoch_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis(),
    };
    let descriptor_path = sessions_dir(&app)?.join(format!("{session_id}.json"));
    write_descriptor(&descriptor_path, &descriptor)?;

    let stop = Arc::new(AtomicBool::new(false));
    let server_stop = Arc::clone(&stop);
    let pending = Arc::clone(&sessions.pending);
    let server_app = app.clone();
    let server_session_id = session_id.clone();
    let server_token = token.clone();
    let thread = std::thread::Builder::new()
        .name("clavierdesk-mcp-bridge".to_string())
        .spawn(move || {
            server::run(
                listener,
                server_app,
                server_session_id,
                server_token,
                pending,
                server_stop,
            )
        })
        .map_err(|error| {
            let _ = fs::remove_file(&descriptor_path);
            error.to_string()
        })?;

    *active = Some(ActiveSession {
        descriptor_path,
        address,
        token,
        stop,
        thread: Some(thread),
    });
    Ok(McpStartResult {
        session_id,
        endpoint,
        pid: std::process::id(),
    })
}

fn probe_bridge(address: SocketAddr, token: String) -> Result<serde_json::Value, String> {
    let mut stream =
        std::net::TcpStream::connect_timeout(&address, std::time::Duration::from_secs(2))
            .map_err(|error| format!("Could not connect to the MCP internal bridge: {error}"))?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(7)))
        .map_err(|error| error.to_string())?;
    let body = br#"{"method":"ping","params":{}}"#;
    let request = format!(
        "POST /bridge HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len(),
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;
    stream.write_all(body).map_err(|error| error.to_string())?;
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|error| error.to_string())?;
    let body_start = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
        .ok_or_else(|| "The MCP bridge returned an invalid HTTP response.".to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&response[body_start..])
        .map_err(|error| format!("The MCP bridge returned invalid JSON: {error}"))?;
    if value.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return Err(format!("The MCP bridge probe failed: {value}"));
    }
    Ok(value)
}

#[tauri::command]
pub async fn mcp_probe_session(
    sessions: State<'_, McpSessions>,
) -> Result<serde_json::Value, String> {
    let (address, token) = {
        let active = sessions
            .active
            .lock()
            .map_err(|_| "MCP session state is unavailable.".to_string())?;
        let session = active
            .as_ref()
            .ok_or_else(|| "No MCP session is running.".to_string())?;
        (session.address, session.token.clone())
    };
    tauri::async_runtime::spawn_blocking(move || probe_bridge(address, token))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn mcp_stop_session(sessions: State<'_, McpSessions>) -> Result<(), String> {
    let session = sessions
        .active
        .lock()
        .map_err(|_| "MCP session state is unavailable.".to_string())?
        .take();
    if let Ok(mut pending) = sessions.pending.lock() {
        pending.clear();
    }
    if let Some(session) = session {
        session.shutdown();
    }
    Ok(())
}
