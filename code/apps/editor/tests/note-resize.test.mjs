import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData, getNoteValueSixteenths } from '../src/model/project.ts';
import {
  addTimelineNoteAt, createTimelineCursor, setTimelineCursorUnit, appendFocusedTimelineTie,
  resizeFocusedTimelineNote, normalizeFocusedTimelineTie, getTimelineTieChain,
  getLocatedTimelineNote, setFocusedTimelineNoteValue,
} from '../src/state/timeline-cursor.ts';

function source(at = 0, count = 2) {
  const project = createProject();
  for (let i = 0; i < count; i++) project.outline.push({ id: `m${i}`, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  return addTimelineNoteAt(project, setTimelineCursorUnit(createTimelineCursor(), '3'), at);
}
const note = (state) => getLocatedTimelineNote(state.project.outline, state.cursor.focusedNoteId).note;
const chain = (state) => getTimelineTieChain(state.project.outline, state.cursor.focusedNoteId);

test('single resize skips unrepresentable lengths without normalizing offbeat notes', () => {
  let state = source(1);
  state.cursor = setTimelineCursorUnit(state.cursor, '1');
  const id = state.cursor.focusedNoteId;
  state = resizeFocusedTimelineNote(state.project, state.cursor, 1);
  assert.deepEqual(note(state).value, { type: 'quarter', dots: 1 });
  assert.equal(state.cursor.focusedNoteId, id);
  assert.equal(state.cursor.positionSixteenths, 1);
  assert.equal(chain(state).length, 1);
  state = resizeFocusedTimelineNote(state.project, state.cursor, -1);
  assert.deepEqual(note(state).value, { type: 'quarter', dots: 0 });
});

test('editing an interior tie changes only its value and moves its successors without changing focus', () => {
  const first = source();
  const tied = appendFocusedTimelineTie(first.project, first.cursor);
  const cursor = setTimelineCursorUnit(first.cursor, '1');
  const state = resizeFocusedTimelineNote(tied.project, cursor, 1);
  assert.deepEqual(chain(state).map(e => [e.positionSixteenths, getNoteValueSixteenths(e.note.value)]), [[0, 6], [6, 4]]);
  assert.equal(state.cursor.focusedNoteId, first.cursor.focusedNoteId);
  assert.equal(chain(state)[1].note.id, tied.cursor.focusedNoteId);
});

test('single resize rejects bar crossing, successor bar crossing and pitch collisions atomically', () => {
  for (const at of [12, 8]) {
    const first = source(at);
    const state = at === 8 ? appendFocusedTimelineTie(first.project, first.cursor) : first;
    const before = structuredClone(state.project);
    assert.equal(resizeFocusedTimelineNote(state.project, setTimelineCursorUnit(first.cursor, '1'), 1), undefined);
    assert.deepEqual(state.project, before);
  }
  const first = source();
  const other = addTimelineNoteAt(first.project, { ...setTimelineCursorUnit(createTimelineCursor('lowerStaff'), '1'), pitch: 60 }, 4, 60);
  assert.equal(resizeFocusedTimelineNote(other.project, setTimelineCursorUnit(first.cursor, '1'), 1), undefined);
});

test('normalization keeps duration and focuses the segment containing the original selected onset', () => {
  const first = source(1);
  const result = normalizeFocusedTimelineTie(first.project, first.cursor);
  assert.deepEqual(chain(result).map(e => getNoteValueSixteenths(e.note.value)), [1, 2, 1]);
  assert.equal(result.cursor.positionSixteenths, 1);
  assert.equal(result.cursor.focusedNoteId, first.cursor.focusedNoteId);
  const base = source();
  const short = setFocusedTimelineNoteValue(base.project, base.cursor, { type: 'eighth', dots: 0 });
  const tied = appendFocusedTimelineTie(short.project, setTimelineCursorUnit(short.cursor, '2'));
  const merged = normalizeFocusedTimelineTie(tied.project, tied.cursor);
  assert.equal(chain(merged).length, 1);
  assert.equal(merged.cursor.positionSixteenths, 0);
  assert.equal(getNoteValueSixteenths(note(merged).value), 4);
  assert.equal(normalizeFocusedTimelineTie(base.project, createTimelineCursor()), undefined);
});

test('single resize respects input increments and stops at the supported value limits', () => {
  const first = source();
  const grown = resizeFocusedTimelineNote(first.project, first.cursor, 1);
  assert.equal(getNoteValueSixteenths(note(grown).value), 8);
  const whole = setFocusedTimelineNoteValue(first.project, first.cursor, { type: 'whole', dots: 0 });
  assert.equal(resizeFocusedTimelineNote(whole.project, whole.cursor, 1), undefined);
  const shortest = setFocusedTimelineNoteValue(first.project, first.cursor, { type: '16th', dots: 0 });
  assert.equal(resizeFocusedTimelineNote(shortest.project, setTimelineCursorUnit(shortest.cursor, '1'), -1), undefined);
});
