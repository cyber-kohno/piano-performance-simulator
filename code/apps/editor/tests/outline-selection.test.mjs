import assert from 'node:assert/strict';
import { test } from 'node:test';
import WorkspaceKeyboard from '../src/ui/keyboard/workspace-keyboard.ts';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';
import { getSelectedOutlineBlocks } from '../src/state/outline-cursor.ts';
import EditorHistory from '../src/service/history/editor-history.ts';

const holds = { rangeSelection: false, pitchSelection: false, diatonicMovement: false, octaveMovement: false,
  keySignatureEditing: false, noteNavigation: false, noteValueEditing: false, tempoEditing: false,
  measureLengthEditing: false, notePositionEditing: false, meterEditing: false };
function fixture() {
  const project = createProject();
  project.outline.push(
    { id: 'm1', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) },
    { id: 'key', type: 'key-change', data: { keySignature: { fifths: 1 } } },
    { id: 'section2', type: 'section', data: { name: 'Second' } },
    { id: 'm2', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) },
    { id: 'm3', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) },
  );
  return { project, outlineCursor: { blockId: 'm1' }, timelineCursor: createTimelineCursor(), mode: 'outline' };
}
function press(state, key, shiftKey = false, repeat = false) {
  return WorkspaceKeyboard.control(state, { key, code: '', shiftKey, repeat }, { ...holds, rangeSelection: shiftKey });
}
const selected = state => getSelectedOutlineBlocks(state.project.outline, state.outlineCursor).map(block => block.id);

test('Shift arrows extend, shrink, reverse and retain outline selection across held repeats', () => {
  let state = fixture();
  state = press(state, 'ArrowDown', true);
  state = press(state, 'ArrowDown', true, true);
  assert.deepEqual(selected(state), ['m1', 'key', 'section2']);
  state = press(state, 'ArrowUp', true);
  assert.deepEqual(selected(state), ['m1', 'key']);
  state = press(state, 'ArrowUp', true);
  assert.deepEqual(selected(state), ['m1']);
  state = press(state, 'ArrowUp', true);
  assert.equal(selected(state).length, 2);
  assert.equal(state.outlineCursor.selectionAnchorBlockId, 'm1');
  state = press(state, 'ArrowDown');
  assert.deepEqual(selected(state), ['m1']);
  assert.equal(state.outlineCursor.selectionAnchorBlockId, undefined);
  state = press(press(state, 'ArrowDown', true), 'Escape');
  assert.equal(selected(state).length, 1);
});

test('mixed outline range deletes atomically and one undo restores the project', () => {
  let state = fixture();
  const original = structuredClone(state.project);
  state = press(press(press(state, 'ArrowDown', true), 'ArrowDown', true), 'ArrowDown', true);
  const history = EditorHistory.create(state);
  const deleted = press(state, 'Delete');
  assert.deepEqual(deleted.project.outline.slice(2).map(block => block.id), ['m3']);
  assert.equal(deleted.outlineCursor.selectionAnchorBlockId, undefined);
  assert.deepEqual(state.project, original);
  history.record(deleted);
  assert.deepEqual(history.undo().project, original);
  assert.deepEqual(history.redo().project, deleted.project);
});

test('whole-outline deletion keeps initial values and required first section', () => {
  let state = fixture();
  state.outlineCursor = { blockId: state.project.outline[0].id };
  for (let i = 1; i < state.project.outline.length; i++) state = press(state, 'ArrowDown', true);
  state = press(state, 'Delete');
  assert.deepEqual(state.project.outline.map(block => block.type), ['init', 'section']);
  assert.ok(state.project.outline.some(block => block.id === state.outlineCursor.blockId));
});
