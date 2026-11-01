import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlNoteMenu, menuItemsAt, noteMenuItems } from '../src/state/note-menu.ts';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { createTimelineCursor, addTimelineNoteAt, appendFocusedTimelineTie, setFocusedNoteStaccato, getLocatedTimelineNote, normalizeFocusedTimelineTie, extendTimelineNoteSelection } from '../src/state/timeline-cursor.ts';
import { createScorePreview } from '../src/model/score-preview.ts';

test('note menu opens Expression instead of modifying staccato', () => {
  assert.deepEqual(noteMenuItems.map(item => item.action), ['expression', 'exit']);
  assert.deepEqual(controlNoteMenu([0], 'Enter'), { path: null, action: 'expression' });
  assert.equal(menuItemsAt([0])[0].label, 'Expression…');
});

test('note menu navigation clamps, closes and keeps parent navigation available for future actions', () => {
  assert.deepEqual(controlNoteMenu([0], 'ArrowUp').path, [0]);
  assert.deepEqual(controlNoteMenu([1], 'ArrowDown').path, [1]);
  assert.deepEqual(controlNoteMenu([0], 'ArrowLeft').path, [0]);
  assert.deepEqual(controlNoteMenu([0], 'ArrowRight').path, [0]);
  for (const key of ['Escape', 'm', 'M']) assert.equal(controlNoteMenu([0], key).path, null);
  assert.deepEqual(controlNoteMenu([1], 'Enter'), { path: null, action: 'exit' });
  assert.deepEqual(controlNoteMenu([0], 'Delete').path, [0]);
});

test('staccato belongs only to the selected chord, survives normalization and exports once', () => {
  const project = createProject();
  project.outline.push({ id: 'm', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  const first = addTimelineNoteAt(project, createTimelineCursor());
  const second = appendFocusedTimelineTie(first.project, first.cursor);
  const before = structuredClone(second.project);
  const updated = setFocusedNoteStaccato(second.project, second.cursor, {type:'normal',lengthRatio:0.5});
  assert.deepEqual(second.project, before);
  assert.equal(getLocatedTimelineNote(updated.outline, first.cursor.focusedNoteId).note.staccato, undefined);
  assert.equal(getLocatedTimelineNote(updated.outline, second.cursor.focusedNoteId).note.staccato.type, 'normal');
  const normalized = normalizeFocusedTimelineTie(updated, second.cursor);
  assert.equal(getLocatedTimelineNote(normalized.project.outline, second.cursor.focusedNoteId).note.staccato.type, 'normal');
  const xml = createScorePreview(updated.outline, 0).xml;
  assert.equal((xml.match(/<staccato\/>/g) ?? []).length, 1);
  const removed = setFocusedNoteStaccato(updated, second.cursor, undefined);
  assert.equal(getLocatedTimelineNote(removed.outline, second.cursor.focusedNoteId).note.staccato, undefined);
  const range = extendTimelineNoteSelection(updated.outline, first.cursor, 1);
  assert.equal(setFocusedNoteStaccato(updated, range, {type:'normal',lengthRatio:0.5}), updated);
  assert.equal(setFocusedNoteStaccato(updated, createTimelineCursor(), {type:'normal',lengthRatio:0.5}), updated);
});
