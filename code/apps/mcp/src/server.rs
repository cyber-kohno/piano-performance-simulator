use crate::bridge;
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig},
    schemars, tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler,
};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CapabilitiesRequest {
    session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(
        description = "Optional operation name, e.g. set_grace_notes, to retrieve its complete parameter schema. Omit for the operation catalog and general restrictions."
    )]
    operation: Option<String>,
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

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScoreReadRequest {
    session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(
        description = "Omit to read the live score without locking. Supply your checkoutId to read staged edits."
    )]
    checkout_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScoreRangeRequest {
    session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    checkout_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(description = "One-based measure number; default 1.")]
    first_measure: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(
        description = "1–8 measures, default 4. Reduce range or filter staff/voice if the response is too large."
    )]
    measure_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(description = "upperStaff or lowerStaff; omit for both.")]
    staff: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Zero-based voice index, 0–2. Omit for all voices.")]
    voice_index: Option<usize>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ApplyEditRequest {
    #[schemars(description = "Complete sessionId returned by list_clavierdesk_sessions.")]
    session_id: String,
    #[schemars(description = "checkoutId returned by begin_checkout.")]
    checkout_id: String,
    #[serde(flatten)]
    edit: EditPayload,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(untagged)]
enum EditPayload {
    Construction(ConstructionRequest),
    Fingering(FingeringRequest),
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConstructionRequest {
    #[schemars(
        description = "Revision returned by begin_checkout or a checkout read. Every new batch must use the latest revision. Identical retries keep their original expectedRevision."
    )]
    expected_revision: String,
    #[schemars(
        description = "Unique ID within this checkout (1–128 ASCII letters, digits, _, ., :, -). Retry identical operations with the same ID after a timeout. Failed requests are not cached."
    )]
    request_id: String,
    // Forward the original JSON so optional nulls and unsupported fields cannot
    // disappear during deserialization before domain validation in the WebView.
    #[schemars(with = "crate::edit_contract::ScoreOperations")]
    operations: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FingeringRequest {
    #[schemars(description = "Legacy single edit: set_pitch_fingering.")]
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

fn forward(session_id: &str, method: &str, mut params: serde_json::Value) -> CallToolResult {
    params.as_object_mut().unwrap().remove("sessionId");
    params["ownerId"] = json!(std::process::id().to_string());
    match bridge::call_session(session_id, method, params) {
        Ok(value) => result(value),
        Err(error) => CallToolResult::error(vec![ContentBlock::text(
            json!({"code": error.code, "message": error.message}).to_string(),
        )]),
    }
}

#[tool_router]
impl ClavierDeskMcpServer {
    pub fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }

    #[tool(
        description = "Read supported semantic editing operations and restrictions from one published GUI session. Pass an operation name to retrieve its exact parameter schema before sending an unfamiliar operation. No checkout required."
    )]
    async fn get_capabilities(
        &self,
        Parameters(request): Parameters<CapabilitiesRequest>,
    ) -> Result<CallToolResult, McpError> {
        Ok(forward(
            &request.session_id,
            "getCapabilities",
            serde_json::to_value(&request).unwrap(),
        ))
    }

    #[tool(
        description = "Read the live score's revision, initial settings, numbered measure IDs, sections, and expression counts without locking the UI. Optionally read your staged checkout. Read again after user edits, undo, or a new checkout."
    )]
    async fn get_score_overview(
        &self,
        Parameters(request): Parameters<ScoreReadRequest>,
    ) -> Result<CallToolResult, McpError> {
        Ok(forward(
            &request.session_id,
            "getScoreOverview",
            serde_json::to_value(&request).unwrap(),
        ))
    }

    #[tool(
        description = "Read 1–8 measures with element IDs, exact quarter-note offsets/durations, spelled pitches, grace notes, expressions, ties/slurs/trills, and independent pedal/ottava events. Defaults to 4 measures. Omit checkoutId for a live read without UI locking; provide it for staged data. Use returned IDs and revision in edits."
    )]
    async fn get_score_range(
        &self,
        Parameters(request): Parameters<ScoreRangeRequest>,
    ) -> Result<CallToolResult, McpError> {
        Ok(forward(
            &request.session_id,
            "getScoreRange",
            serde_json::to_value(&request).unwrap(),
        ))
    }

    #[tool(
        description = "Discard all staged changes and release your checkout without committing or adding undo history. Old checkoutId is invalid after cancellation."
    )]
    async fn cancel_checkout(
        &self,
        Parameters(request): Parameters<CheckoutRequest>,
    ) -> Result<CallToolResult, McpError> {
        Ok(forward(
            &request.session_id,
            "cancelCheckout",
            json!({"checkoutId": request.checkout_id}),
        ))
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
        description = "Apply semantic edits atomically to a staged checkout: create/append/insert/remove measures, replace voices, correct pitches and values, edit grace notes/fingering/articulations, ties/slurs/trills, and independent pedal/ottava events and score settings. Read get_capabilities and get_score_range. Every batch requires requestId and expectedRevision from your latest checkout read or begin_checkout; after success use its new revision. Identical retries retain original requestId, expectedRevision and operations. At most 64 operations, 32 new measures and 48 KiB operations JSON per request. No silent orphan cleanup: detach or retarget relationships explicitly in the same batch. set_value does not fill rests; balance durations in the batch or replace_voice. finish_checkout commits all staged changes as one Undo entry. Legacy single set_pitch_fingering remains supported."
    )]
    async fn apply_edit(
        &self,
        Parameters(request): Parameters<ApplyEditRequest>,
    ) -> Result<CallToolResult, McpError> {
        let mut params = serde_json::to_value(&request).expect("serializable edit request");
        params.as_object_mut().unwrap().remove("sessionId");
        params["ownerId"] = json!(std::process::id().to_string());
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
            .with_instructions("Use list_clavierdesk_sessions and match the complete sessionId with the GUI. Read get_capabilities and get_score_overview/get_score_range without locking the UI. begin_checkout returns checkoutId and revision. Every new apply_edit batch needs requestId and expectedRevision from the latest checkout read or begin_checkout; successful batches return a new revision. Retry identical requests with their original requestId and expectedRevision. Edits remain staged until finish_checkout commits as one Undo entry and unlocks UI. cancel_checkout or the user's Ctrl+Shift+M discards staged edits. Re-read after a new checkout or user edits. Target notes with returned stable IDs; pedal/ottava use measure IDs and exact quarter-note offsets. Images are interpreted by the agent; neither MCP success nor structural validation proves correspondence to an image.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn construction_payload_preserves_domain_validation_input() {
        let payload = json!({"sessionId": "session", "checkoutId": "checkout", "requestId": "page1", "expectedRevision": "revision",
            "operations": [{"type": "create_score", "settings": {"meter": [4,4], "keyFifths": 0, "tempo": 100},
                "measures": [{"upper": null, "unsupported": true}]}]});
        let parsed: ApplyEditRequest = serde_json::from_value(payload.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), payload);
        let legacy = json!({"sessionId": "session", "checkoutId": "checkout", "operation": "set_pitch_fingering",
            "noteId": "note", "staff": "upperStaff", "pitchIndex": 0, "fingering": 2});
        assert!(serde_json::from_value::<ApplyEditRequest>(legacy).is_ok());
    }

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
        for name in [
            "get_capabilities",
            "get_score_overview",
            "get_score_range",
            "cancel_checkout",
        ] {
            assert!(router.has_route(name));
        }
        assert_eq!(router.list_all().len(), 11);
    }
}
