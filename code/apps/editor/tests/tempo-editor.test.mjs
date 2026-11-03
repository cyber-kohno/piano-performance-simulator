import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTempoEditor, controlTempoEditor } from '../src/state/tempo-editor.ts';

test('Off Enter initializes current tempo and opens detail; Backspace preserves the draft for reentry', () => {
  const initial = createTempoEditor(undefined, 137);
  assert.equal(initial.bpm, null);
  assert.equal(controlTempoEditor(initial, 'ArrowRight'), initial);
  let editor = controlTempoEditor(initial, 'Enter');
  assert.equal(editor.bpm, 137);
  assert.equal(editor.detail, true);
  editor = controlTempoEditor(editor, 'ArrowRight');
  editor = controlTempoEditor(editor, 'Backspace');
  assert.equal(editor.bpm, 138);
  assert.equal(editor.detail, false);
  assert.equal(controlTempoEditor(editor, 'Enter').bpm, 138);
  assert.equal(initial.bpm, null);
});

test('Delete removes only at the parent, and recreating the optional setting uses current tempo', () => {
  const initial = createTempoEditor(80, 80);
  const detail = controlTempoEditor(initial, 'Enter');
  assert.equal(controlTempoEditor(detail, 'Delete'), detail);
  assert.equal(controlTempoEditor(detail, 'Enter'), detail);
  const changed = controlTempoEditor(detail, 'ArrowLeft');
  const removed = controlTempoEditor(controlTempoEditor(changed, 'Backspace'), 'Delete');
  assert.equal(removed.bpm, null);
  assert.equal(controlTempoEditor(removed, 'Enter').bpm, 80);
  for (const [bpm, key] of [[10, 'ArrowLeft'], [400, 'ArrowRight']]) {
    assert.equal(controlTempoEditor(controlTempoEditor(createTempoEditor(bpm, bpm), 'Enter'), key).bpm, bpm);
  }
});
