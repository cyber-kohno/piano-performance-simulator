import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';
import NoteEditor from '../src/action/editor/note-editor.ts';
import OutlineEditor from '../src/action/editor/outline-editor.ts';
import Timeline from '../src/domain/score/score-timeline.ts';
import EditorHistory from '../src/service/history/editor-history.ts';
import { createProjectFingerprint } from '../src/service/project/project-fingerprint.ts';
import ProjectFile from '../src/infra/tauri/project-file.ts';
import FileController from '../src/service/project/score-project-file-controller.ts';
import McpController from '../src/service/mcp/mcp-editor-controller.ts';

function fixture() {
  const project = createProject(), data = createMeasureData({ cnt: 4, unit: 4 });
  data.upperStaff.voices[0].elements = [
    { id: 'a', kind: 'note', value: { type: 'quarter', dots: 0 }, pitches: [{ midi: 72 }] },
    { id: 'r', kind: 'rest', value: { type: 'quarter', dots: 0 } },
    { id: 'b', kind: 'note', value: { type: 'half', dots: 0 }, pitches: [{ midi: 74 }] },
  ];
  project.outline.push({ id: 'm', type: 'measure', data });
  return project;
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
async function projectState(initialProject) {
  // Compile the actual App declaration, rather than a separately written state
  // implementation. Derived readers exercise the downstream update contract.
  const app = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8');
  const declaration = app.match(/let project = [^;]+;/)?.[0];
  assert.ok(declaration);
  const source = `export function create(initialProject, fingerprint) {
    ${declaration}
    const content = $derived(fingerprint(project));
    const tempo = $derived(project.outline[0].data.tempo);
    return { get project() { return project; }, get content() { return content; },
      get tempo() { return tempo; }, replace(next) { project = next; } };
  }`;
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const compiled = compileModule(js, { filename: 'project-state.svelte.js', generate: 'client' }).js.code
    .replace(/(['"])svelte\/internal\/client\1/g, JSON.stringify(import.meta.resolve('svelte/internal/client')));
  const { create } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
  return create(initialProject, createProjectFingerprint());
}

test('App retains plain immutable snapshots and updates derived readers through edits and Undo/Redo', async () => {
  const initial = fixture(), state = await projectState(initial);
  assert.equal(state.project, initial);
  assert.equal(state.project.outline[2], initial.outline[2]);
  const saved = state.content;
  assert.equal(saved, JSON.stringify(initial));
  const cursor = { ...createTimelineCursor(), focusedNoteId: 'a', focusedPitchIndex: 0, pitch: 72,
    placementValue: { type: '16th', dots: 0 } };
  const history = EditorHistory.create({ project: initial });
  for (const edit of [
    project => NoteEditor.movePitch(project, cursor, 1),
    project => NoteEditor.move(project, cursor, 1),
    project => NoteEditor.setValue(project, cursor, { type: 'half', dots: 0 }),
  ]) {
    state.replace(initial);
    const result = edit(freeze(initial));
    assert.ok(result);
    state.replace(result.project);
    assert.equal(state.project, result.project);
    assert.equal(state.content, JSON.stringify(result.project));
    assert.notEqual(state.content, saved);
    assert.equal(JSON.stringify(initial), saved);
  }
  const changed = OutlineEditor.changeTempo(freeze(initial), { blockId: initial.outline[0].id }, 1);
  state.replace(changed); history.record({ project: changed });
  assert.equal(state.tempo, initial.outline[0].data.tempo + 1);
  assert.notEqual(state.content, saved);
  state.replace(history.undo().project);
  assert.equal(state.content, saved);
  assert.equal(state.tempo, initial.outline[0].data.tempo);
  state.replace(history.redo().project);
  assert.equal(state.project, changed);
  assert.equal(state.content, JSON.stringify(changed));
});

test('plain snapshots round-trip through file save/load and MCP staged edits without mutating the live score', async t => {
  const initial = freeze(fixture()), state = await projectState(initial);
  const saved = state.content;
  const handle = { path: 'memory.clavierdesk', name: 'memory.clavierdesk' };
  let fileText;
  t.mock.method(ProjectFile, 'saveAsPath', async () => handle);
  t.mock.method(ProjectFile, 'write', async (_handle, text) => { fileText = text; });
  t.mock.method(ProjectFile, 'openPath', async () => handle);
  t.mock.method(ProjectFile, 'read', async () => fileText);
  const savedFile = await FileController.saveAs(state.project);
  assert.equal(savedFile.type, 'success');
  assert.equal(savedFile.value.fingerprint, saved);
  const loaded = await FileController.load();
  assert.equal(loaded.type, 'success');
  state.replace(loaded.value.project);
  assert.equal(state.project, loaded.value.project);
  assert.equal(state.content, saved);
  const beforeCheckout = freeze(state.project);
  const controller = McpController.create({
    getEditorState: project => ({ project }), checkoutBlocker: () => null,
    getEditContext: () => ({ project: state.project, timelineCursor: createTimelineCursor() }),
    updateProject(before, next) { assert.equal(before, state.project); state.replace(next); },
    checkoutChanged() {},
  });
  const call = (method, params = {}) => controller.handle({ id: 'test', method, params: { ownerId: 'test', ...params } });
  const begin = call('beginCheckout').result;
  const applied = call('applyEdit', { checkoutId: begin.checkoutId, expectedRevision: begin.revision,
    requestId: 'change-pitch', operations: [{ type: 'set_pitches', noteId: 'a', pitches: ['D5'] }] });
  assert.equal(applied.result.changed, true);
  assert.equal(state.project, beforeCheckout);
  assert.equal(state.content, saved);
  assert.equal(call('finishCheckout', { checkoutId: begin.checkoutId }).result.changed, true);
  assert.notEqual(state.project, beforeCheckout);
  assert.equal(Timeline.note(state.project.outline, 'a').note.pitches[0].midi, 74);
  assert.equal(state.content, JSON.stringify(state.project));
  assert.notEqual(state.content, saved);
  assert.equal(JSON.stringify(initial), saved);
});
