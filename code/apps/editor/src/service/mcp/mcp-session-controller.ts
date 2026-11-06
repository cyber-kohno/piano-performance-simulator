export type McpSessionDetails = { sessionId: string; endpoint: string; pid: number };
export type McpBridgeRequest = { id: string; method: string; params: unknown };
export type McpBridgeResponse = {
  id: string;
  result?: unknown;
  error?: { code: string; message: string };
};
export type McpSessionState = {
  status: 'stopped' | 'starting' | 'available' | 'stopping' | 'error';
  details: McpSessionDetails | null;
  error: string | null;
};
export type McpSessionPort = {
  startSession(): Promise<McpSessionDetails>;
  stopSession(): Promise<void>;
  probeSession(): Promise<unknown>;
  onRequest(handler: (request: McpBridgeRequest) => void): Promise<() => void>;
  respond(response: McpBridgeResponse): Promise<void>;
};

namespace McpSessionController {
  export function create(port: McpSessionPort, update: (state: McpSessionState) => void) {
    let state: McpSessionState = { status: 'stopped', details: null, error: null };
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let operation: Promise<void> | undefined;
    const publish = (next: McpSessionState) => {
      state = next;
      if (!disposed) update(next);
    };

    async function toggle() {
      if (disposed || operation) return;
      operation = changePublication();
      try { await operation; } finally { operation = undefined; }
    }

    async function changePublication() {
      const stopping = state.status === 'available';
      publish({ ...state, status: stopping ? 'stopping' : 'starting', error: null });
      try {
        // Also clears a bridge left behind by a WebView reload.
        await port.stopSession();
        if (stopping) {
          publish({ status: 'stopped', details: null, error: null });
          return;
        }
        if (disposed) return;
        if (!unlisten) unlisten = await port.onRequest(request => {
          if (disposed) return;
          const response: McpBridgeResponse = request.method === 'ping'
            ? { id: request.id, result: { application: 'ClavierDesk', status: 'ok' } }
            : { id: request.id, error: { code: 'UNKNOWN_METHOD', message: 'This MCP method is not supported.' } };
          void port.respond(response).catch(error => console.error('Failed to respond to MCP request:', error));
        });
        if (disposed) return;
        const details = await port.startSession();
        if (disposed) return;
        await port.probeSession();
        publish({ status: 'available', details, error: null });
      } catch (error) {
        // A failed start/probe must not leave a published session behind.
        let message = String(error);
        try { await port.stopSession(); } catch (cleanupError) {
          message += `; session cleanup failed: ${String(cleanupError)}`;
        }
        publish({ status: 'error', details: null, error: message });
      }
    }

    return {
      async initialize() {
        if (disposed || operation) return;
        operation = port.stopSession().then(() => {
          publish({ status: 'stopped', details: null, error: null });
        }).catch(error => {
          publish({ status: 'error', details: null, error: String(error) });
        });
        try { await operation; } finally { operation = undefined; }
      },
      toggle,
      async dispose() {
        disposed = true;
        await operation;
        try { await port.stopSession(); } finally { unlisten?.(); unlisten = undefined; }
      },
    };
  }
}
export default McpSessionController;
