import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { McpSessionPort, McpBridgeRequest } from '../../service/mcp/mcp-session-controller.ts';

const TauriMcp: McpSessionPort = {
  startSession: () => invoke('mcp_start_session'),
  stopSession: () => invoke('mcp_stop_session'),
  probeSession: () => invoke('mcp_probe_session'),
  respond: response => invoke('mcp_respond', { response }),
  onRequest: handler => listen<McpBridgeRequest>('clavierdesk://mcp/request', event => handler(event.payload)),
};
export default TauriMcp;
