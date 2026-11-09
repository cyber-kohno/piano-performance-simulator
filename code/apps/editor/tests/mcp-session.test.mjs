import test from 'node:test';
import assert from 'node:assert/strict';
import McpSessionController from '../src/service/mcp/mcp-session-controller.ts';
import McpEditorController from '../src/service/mcp/mcp-editor-controller.ts';
import ScoreProjectFactory from '../src/domain/score/score-project.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';

function fixture(overrides = {}) {
  const calls = [], states = [], responses = [];
  let handler;
  const port = {
    async stopSession() { calls.push('stop'); },
    async startSession() { calls.push('start'); return { sessionId: 'session-a', endpoint: 'http://127.0.0.1:1234', pid: 123 }; },
    async probeSession() { calls.push('probe'); handler({ id: 'probe', method: 'ping', params: {} }); },
    async onRequest(callback) { calls.push('listen'); handler = callback; return () => calls.push('unlisten'); },
    async respond(response) { responses.push(response); },
    ...overrides,
  };
  const checkouts = [];
  const project = ScoreProjectFactory.create();
  const editor = McpEditorController.create({
    checkoutBlocker: () => null,
    getEditorState: project => ({ project }),
    getEditContext: () => ({ project, timelineCursor: createTimelineCursor() }),
    updateProject: () => {},
    checkoutChanged: state => checkouts.push(state),
  });
  const controller = McpSessionController.create(port, state => states.push(state), editor);
  return { calls, states, responses, checkouts, controller, request: value => handler(value) };
}

test('publishes only after the WebView listener and end-to-end probe are ready; toggles off', async () => {
  const f = fixture();
  await f.controller.toggle();
  assert.deepEqual(f.calls, ['stop', 'listen', 'start', 'probe']);
  assert.equal(f.states.at(-1).status, 'available');
  assert.equal(f.states.at(-1).details.sessionId, 'session-a');
  assert.deepEqual(f.responses, [{ id: 'probe', result: { application: 'ClavierDesk', status: 'ok' } }]);
  f.request({ id: 'unknown', method: 'editScore', params: {} });
  assert.equal(f.responses.at(-1).error.code, 'UNKNOWN_METHOD');
  f.request({ id: 'checkout', method: 'beginCheckout', params: { ownerId: 'a' } });
  assert.equal(f.checkouts.at(-1).active, true);
  await f.controller.toggle();
  assert.equal(f.checkouts.at(-1).active, false);
  assert.equal(f.states.at(-1).status, 'stopped');
  assert.equal(f.states.at(-1).details, null);
  await f.controller.toggle();
  assert.equal(f.calls.filter(call => call === 'listen').length, 1);
  await f.controller.dispose();
  assert.equal(f.calls.at(-1), 'unlisten');
});

test('a failed WebView probe withdraws publication and can be retried', async () => {
  let fail = true;
  const f = fixture({ async probeSession() { if (fail) throw new Error('WebView unavailable'); } });
  await f.controller.toggle();
  assert.equal(f.states.at(-1).status, 'error');
  assert.match(f.states.at(-1).error, /WebView unavailable/);
  assert.equal(f.calls.at(-1), 'stop');
  fail = false;
  await f.controller.toggle();
  assert.equal(f.states.at(-1).status, 'available');
  await f.controller.dispose();
});

test('initialization withdraws any bridge surviving a WebView reload without publishing', async () => {
  const f = fixture();
  await f.controller.initialize();
  assert.deepEqual(f.calls, ['stop']);
  assert.equal(f.states.at(-1).status, 'stopped');
  await f.controller.dispose();
});

test('repeated toggles during startup do not publish multiple sessions; dispose waits and stops', async () => {
  let finishStart;
  const f = fixture({ startSession() { f.calls.push('start'); return new Promise(resolve => finishStart = resolve); } });
  const starting = f.controller.toggle();
  while (!finishStart) await Promise.resolve();
  await f.controller.toggle();
  const disposing = f.controller.dispose();
  finishStart({ sessionId: 'session-a', endpoint: 'http://127.0.0.1:1234', pid: 123 });
  await Promise.all([starting, disposing]);
  assert.equal(f.calls.filter(call => call === 'start').length, 1);
  assert.equal(f.calls.includes('probe'), false);
  assert.deepEqual(f.calls.slice(-2), ['stop', 'unlisten']);
  assert.equal(f.states.some(state => state.status === 'available'), false);
  await f.controller.toggle();
  assert.equal(f.calls.filter(call => call === 'start').length, 1);
});
