use crate::bridge;
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig},
    schemars, tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Clone)]
pub struct ClavierDeskMcpServer {
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}
fn checkout_params(session_id: &str) -> serde_json::Value {
    json!({ "sessionId": session_id, "ownerId": std::process::id().to_string() })
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SessionRequest {
    #[schemars(description = "Complete sessionId returned by list_clavierdesk_sessions.")]
    session_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CheckoutRequest {
    session_id: String,
    #[schemars(
        description = "checkoutId returned by begin_checkout. Invalid after completion or forced stop."
    )]
    checkout_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ApplyEditRequest {
    #[schemars(description = "Complete sessionId returned by list_clavierdesk_sessions.")]
    session_id: String,
    #[schemars(description = "checkoutId returned by begin_checkout.")]
    checkout_id: String,
    #[schemars(description = "Currently supported operation: set_pitch_fingering.")]
    operation: String,
    note_id: String,
    staff: String,
    pitch_index: usize,
    fingering: u8,
    #[serde(default)]
    substitution_fingering: Option<u8>,
}

fn result(value: serde_json::Value) -> CallToolResult {
    CallToolResult::success(vec![ContentBlock::text(value.to_string())])
}

#[tool_router]
impl ClavierDeskMcpServer {
    pub fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }

    #[tool(
        description = "Check that the ClavierDesk MCP adapter is running. ClavierDesk need not be open."
    )]
    async fn ping(&self) -> Result<CallToolResult, McpError> {
        Ok(result(
            json!({ "application": "ClavierDesk", "status": "ok", "appRequired": false }),
        ))
    }

    #[tool(
        description = "List currently published local ClavierDesk sessions. Rechecks each session's authenticated health endpoint on every call. An empty list means ClavierDesk is closed or MCP is stopped."
    )]
    async fn list_clavierdesk_sessions(&self) -> Result<CallToolResult, McpError> {
        Ok(result(json!({ "sessions": bridge::list_sessions() })))
    }

    #[tool(
        description = "Check the full connection to one published ClavierDesk GUI session, including its WebView. Call list_clavierdesk_sessions first and pass its complete sessionId."
    )]
    async fn probe_session(
        &self,
        Parameters(request): Parameters<SessionRequest>,
    ) -> Result<CallToolResult, McpError> {
        match bridge::call_session(&request.session_id, "ping", json!({})) {
            Ok(value) => Ok(result(
                json!({ "sessionId": request.session_id, "gui": value }),
            )),
            Err(error) => Ok(CallToolResult::error(vec![ContentBlock::text(
                json!({ "code": error.code, "message": error.message }).to_string(),
            )])),
        }
    }

    #[tool(
        description = "Begin an exclusive ClavierDesk edit checkout. Returns checkoutId, required for all checkout requests. Refused while a draft, menu, dialog, file operation, or playback is active. UI editing is locked; changes are staged until finish_checkout."
    )]
    async fn begin_checkout(
        &self,
        Parameters(request): Parameters<SessionRequest>,
    ) -> Result<CallToolResult, McpError> {
        match bridge::call_session(
            &request.session_id,
            "beginCheckout",
            checkout_params(&request.session_id),
        ) {
            Ok(value) => Ok(result(value)),
            Err(error) => Ok(CallToolResult::error(vec![ContentBlock::text(
                json!({"code": error.code, "message": error.message}).to_string(),
            )])),
        }
    }

    #[tool(
        description = "Commit all staged changes once, release the checkout and unlock UI editing, then show a completion notice. A forced stop invalidates checkoutId and discards staged changes."
    )]
    async fn finish_checkout(
        &self,
        Parameters(request): Parameters<CheckoutRequest>,
    ) -> Result<CallToolResult, McpError> {
        match bridge::call_session(
            &request.session_id,
            "finishCheckout",
            json!({ "ownerId": std::process::id().to_string(), "checkoutId": request.checkout_id }),
        ) {
            Ok(value) => Ok(result(value)),
            Err(error) => Ok(CallToolResult::error(vec![ContentBlock::text(
                json!({"code": error.code, "message": error.message}).to_string(),
            )])),
        }
    }

    #[tool(
        description = "Read the checkout's staged score and editor state. Requires checkoutId from begin_checkout, owned by this MCP process."
    )]
    async fn get_editor_state(
        &self,
        Parameters(request): Parameters<CheckoutRequest>,
    ) -> Result<CallToolResult, McpError> {
        match bridge::call_session(
            &request.session_id,
            "getEditorState",
            json!({ "ownerId": std::process::id().to_string(), "checkoutId": request.checkout_id }),
        ) {
            Ok(value) => Ok(result(value)),
            Err(error) => Ok(CallToolResult::error(vec![ContentBlock::text(
                json!({"code": error.code, "message": error.message}).to_string(),
            )])),
        }
    }

    #[tool(
        description = "Stage a validated semantic edit without changing the live score. Requires checkoutId from begin_checkout. Call finish_checkout to commit all staged edits once. Supported operation: set_pitch_fingering, targeting a pitch by noteId, staff, and pitchIndex."
    )]
    async fn apply_edit(
        &self,
        Parameters(request): Parameters<ApplyEditRequest>,
    ) -> Result<CallToolResult, McpError> {
        let params = json!({ "ownerId": std::process::id().to_string(), "checkoutId": request.checkout_id, "operation": request.operation, "noteId": request.note_id, "staff": request.staff, "pitchIndex": request.pitch_index, "fingering": request.fingering, "substitutionFingering": request.substitution_fingering });
        match bridge::call_session(&request.session_id, "applyEdit", params) {
            Ok(value) => Ok(result(value)),
            Err(error) => Ok(CallToolResult::error(vec![ContentBlock::text(
                json!({"code": error.code, "message": error.message}).to_string(),
            )])),
        }
    }
}

#[tool_handler]
impl ServerHandler for ClavierDeskMcpServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new(env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"))
                    .with_title("ClavierDesk MCP"),
            )
            .with_instructions("Use list_clavierdesk_sessions to discover sessions published with Ctrl+M in ClavierDesk. Pass the complete sessionId to each session tool. Call begin_checkout and pass its checkoutId to get_editor_state, apply_edit, and finish_checkout. Edits are staged; finish_checkout commits once and unlocks UI before displaying a notice. The user can force stop via Ctrl+Shift+M or the Stop MCP editing button, discarding staged edits and invalidating checkoutId. Do not retry old requests with a new checkoutId; re-read the score after a new checkout.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_tool_catalog() {
        let router = ClavierDeskMcpServer::tool_router();
        assert!(router.has_route("ping"));
        assert!(router.has_route("list_clavierdesk_sessions"));
        assert!(router.has_route("probe_session"));
        assert!(router.has_route("begin_checkout"));
        assert!(router.has_route("finish_checkout"));
        assert!(router.has_route("get_editor_state"));
        assert!(router.has_route("apply_edit"));
        assert_eq!(router.list_all().len(), 7);
    }
}
