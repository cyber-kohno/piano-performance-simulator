use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{mpsc::SyncSender, Mutex},
};
use tauri::State;

use super::session::McpSessions;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBridgeRequest {
    pub id: String,
    pub method: String,
    pub params: Value,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBridgeError {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBridgeResponse {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<McpBridgeError>,
}

pub type PendingResponses = Mutex<HashMap<String, SyncSender<McpBridgeResponse>>>;

#[tauri::command]
pub fn mcp_respond(
    sessions: State<'_, McpSessions>,
    response: McpBridgeResponse,
) -> Result<(), String> {
    let sender = sessions
        .pending()
        .lock()
        .map_err(|_| "MCP response state is unavailable.".to_string())?
        .remove(&response.id)
        .ok_or_else(|| "MCP request is no longer pending.".to_string())?;
    sender
        .send(response)
        .map_err(|_| "MCP request receiver is unavailable.".to_string())
}
