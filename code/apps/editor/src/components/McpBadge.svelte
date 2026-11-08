<script lang="ts">
  import type { McpSessionState } from '../service/mcp/mcp-session-controller.ts';
  let { state }: { state: McpSessionState } = $props();
</script>

<div class="mcp-status" class:available={state.status === 'available'} class:error={state.status === 'error'}
  class:pending={state.status === 'starting' || state.status === 'stopping'}
  role="status" aria-live="polite" title={state.error ?? state.details?.sessionId ?? undefined}>
  <span class="indicator" aria-hidden="true"></span>
  <span>MCP {state.status === 'available' ? 'ON' : state.status === 'stopped' ? 'OFF' : state.status.toUpperCase()}</span>
  {#if state.details}<span class="session-id" aria-label={`Session ID ${state.details.sessionId}`}>· {state.details.sessionId.slice(0, 8)}</span>{/if}
</div>

<style>
  .mcp-status { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border: 1px solid #779b9555; border-radius: 999px; background: #edf3f3; color: #46625d; font-size: 11px; font-weight: 700; line-height: 1; white-space: nowrap; }
  .indicator { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .available { border-color: #8fcbd3; background: #e8f7f8; color: #247b87; }
  .pending { border-color: #dcc68a; background: #fff9e8; color: #87691a; }
  .error { border-color: #e2a8ae; background: #fff0f1; color: #a5323d; }
  .session-id { color: #304b55; font: 700 10px ui-monospace, Consolas, monospace; }
</style>
