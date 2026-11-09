import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export async function connect(executable) {
  const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map();
  let sequence = 0;
  const rejectAll = error => { for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(error); } pending.clear(); };
  child.on('error', rejectAll);
  child.on('exit', code => rejectAll(new Error(`MCP exited: ${code}`)));
  child.stderr.on('data', data => process.stderr.write(data));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const response = JSON.parse(line), task = pending.get(response.id);
    if (!task) return;
    clearTimeout(task.timeout); pending.delete(response.id);
    if (response.error) task.reject(new Error(JSON.stringify(response.error))); else task.resolve(response.result);
  });
  function call(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timeout });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  function close() { lines.close(); child.stdin.end(); child.kill(); rejectAll(new Error('Client closed')); }
  try {
    await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'clavierdesk-editing-smoke', version: '0.1.0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  } catch (error) { close(); throw error; }
  return { call, close };
}
