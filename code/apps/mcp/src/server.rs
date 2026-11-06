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

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SessionRequest {
    #[schemars(description = "Complete sessionId returned by list_clavierdesk_sessions.")]
    session_id: String,
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
}

#[tool_handler]
impl ServerHandler for ClavierDeskMcpServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new(env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"))
                    .with_title("ClavierDesk MCP"),
            )
            .with_instructions("Use list_clavierdesk_sessions to discover sessions published with Ctrl+M in ClavierDesk. Match the complete sessionId to the ID shown in the app, then call probe_session with that ID. Always specify a session explicitly. This MVP provides connectivity only; no score or editor state is read or changed.".to_string())
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
        assert_eq!(router.list_all().len(), 3);
    }
}
