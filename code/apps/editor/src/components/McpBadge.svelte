<script lang="ts">
  import type { McpSessionState } from '../service/mcp/mcp-session-controller.ts';
  let { state }: { state: McpSessionState } = $props();
</script>

<div class="mcp-status" class:available={state.status === 'available'} class:error={state.status === 'error'}
  role="status" title={state.error ?? 'Toggle session publication with Ctrl+M'}>
  <span>MCP {state.status === 'available' ? 'ON' : state.status === 'stopped' ? 'OFF' : state.status.toUpperCase()}</span>
  {#if state.details}
    <input aria-label="MCP session ID" readonly value={state.details.sessionId} onfocus={event => event.currentTarget.select()} />
  {:else}<small>Ctrl+M</small>{/if}
</div>

<style>
  .mcp-status { flex: 0 0 auto; display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #46625d; }
  .available { color: #145e4f; }
  .error { color: #9a3026; }
  input { width: 36ch; padding: 0; border: 0; background: transparent; color: inherit; font: 10px monospace; cursor: text; }
  small { font-size: 10px; }
</style>
