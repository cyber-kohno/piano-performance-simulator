// Exercise the actual stdio transport without configuring a particular agent client.
// node smoke.mjs [executable] [expected-session-id]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const executable = process.argv[2] ?? fileURLToPath(new URL(
  process.platform === 'win32' ? './target/release/clavierdesk-mcp.exe' : './target/release/clavierdesk-mcp', import.meta.url));
const expectedSessionId = process.argv[3] === '--absent' ? undefined : process.argv[3];
const absentSessionId = process.argv[3] === '--absent' ? process.argv[4] : undefined;
const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const pending = new Map();
let sequence = 0;
const rejectAll = error => {
  for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(error); }
  pending.clear();
};
child.on('error', rejectAll);
child.on('exit', code => rejectAll(new Error(`MCP exited with code ${code}`)));
child.stderr.on('data', data => process.stderr.write(data));
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  const response = JSON.parse(line);
  const task = pending.get(response.id);
  if (!task) return;
  clearTimeout(task.timeout);
  pending.delete(response.id);
  if (response.error) task.reject(new Error(JSON.stringify(response.error)));
  else task.resolve(response.result);
});
function call(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function value(result) {
  assert.equal(result.isError ?? false, false, JSON.stringify(result));
  return JSON.parse(result.content.find(item => item.type === 'text').text);
}
try {
  const initialized = await call('initialize', {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'clavierdesk-smoke', version: '0.1.0' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  assert.equal(initialized.serverInfo.name, 'clavierdesk-mcp');
  const catalog = await call('tools/list');
  assert.deepEqual(catalog.tools.map(tool => tool.name).sort(), ['apply_edit', 'begin_checkout', 'cancel_checkout', 'finish_checkout', 'get_capabilities', 'get_editor_state', 'get_score_overview', 'get_score_range', 'list_clavierdesk_sessions', 'ping', 'probe_session']);
  for (const name of ['get_editor_state', 'apply_edit', 'finish_checkout']) {
    assert.ok(catalog.tools.find(tool => tool.name === name).inputSchema.required.includes('checkoutId'));
  }
  console.log('Tools:', catalog.tools.map(tool => tool.name).join(', '));
  const constructionSchema = JSON.stringify(catalog.tools.find(tool => tool.name === 'apply_edit').inputSchema);
  for (const field of ['requestId', 'expectedRevision', 'operations', 'create_score', 'append_measures', 'tuplet', 'set_grace_notes', 'set_trill', 'set_pedal_event']) assert.ok(constructionSchema.includes(field));
  const construction = await call('tools/call', { name: 'apply_edit', arguments: {
    sessionId: '../invalid', checkoutId: 'invalid', requestId: 'schema-smoke', expectedRevision: 'invalid', operations: [{
      type: 'create_score', settings: { meter: [4, 4], keyFifths: 0, tempo: 100 }, measures: [{}],
    }],
  } });
  assert.equal(construction.isError, true);
  assert.equal(JSON.parse(construction.content[0].text).code, 'SESSION_NOT_AVAILABLE');
  assert.equal(value(await call('tools/call', { name: 'ping', arguments: {} })).status, 'ok');
  const { sessions } = value(await call('tools/call', { name: 'list_clavierdesk_sessions', arguments: {} }));
  console.log('Sessions:', JSON.stringify(sessions));
  if (expectedSessionId) assert.ok(sessions.some(session => session.sessionId === expectedSessionId), 'Expected GUI session is not published');
  if (absentSessionId) {
    assert.ok(!sessions.some(session => session.sessionId === absentSessionId), 'Withdrawn session is still listed');
    const rejected = await call('tools/call', { name: 'probe_session', arguments: { sessionId: absentSessionId } });
    assert.equal(rejected.isError, true);
    assert.equal(JSON.parse(rejected.content[0].text).code, 'SESSION_NOT_AVAILABLE');
    console.log('Withdrawn session rejected:', absentSessionId);
  }
  for (const session of sessions) {
    const result = value(await call('tools/call', { name: 'probe_session', arguments: { sessionId: session.sessionId } }));
    assert.equal(result.sessionId, session.sessionId);
    assert.deepEqual(result.gui, { application: 'ClavierDesk', status: 'ok' });
    console.log('GUI probe OK:', result.sessionId);
  }
  const invalid = await call('tools/call', { name: 'probe_session', arguments: { sessionId: '../invalid' } });
  assert.equal(invalid.isError, true);
  console.log('Invalid session rejected. stdio smoke passed.');
} finally {
  lines.close();
  child.stdin.end();
  child.kill();
}
