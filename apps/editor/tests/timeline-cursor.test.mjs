import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMeasureData, createProject } from '../src/model/project.ts';
import {
  addFocusedNotePitch, addTimelineNoteAt, createTimelineCursor,
  getLocatedTimelineNote, moveFocusedTimelineNotePitch,
  moveTimelineCursorHorizontally, selectFocusedNotePitch,
  deleteFocusedTimelineNote,
  getDiatonicPitchClasses, moveTimelineCursorPitch,
  focusAdjacentTimelineNote,
} from '../src/state/timeline-cursor.ts';

function singleNote(midi = 60) {
  const project = createProject();
  project.outline.push({ id: 'measure-0', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  return addTimelineNoteAt(project, createTimelineCursor(), 0, midi);
}

const pitchesOf = ({ project, cursor }) =>
  getLocatedTimelineNote(project.outline, cursor.focusedNoteId).note.pitches;

test('E navigation crosses gaps and measure boundaries in chronological order, selecting highest pitch', () => {
  const initial = singleNote();
  initial.project.outline.push({ id: 'measure-1', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  const late = addTimelineNoteAt(initial.project, initial.cursor, 20, 72);
  const middle = addTimelineNoteAt(late.project, { ...late.cursor, operationUnit: { cnt: 1, unit: 4 } }, 8, 65);
  const chord = addFocusedNotePitch(middle.project, middle.cursor);
  const before = structuredClone(chord.project);
  let cursor = focusAdjacentTimelineNote(chord.project.outline, initial.cursor, 1);
  assert.equal(cursor.focusedNoteId, middle.cursor.focusedNoteId);
  assert.equal(cursor.focusedPitchIndex, 0);
  assert.equal(cursor.pitch, 65);
  assert.equal(cursor.positionSixteenths, 8);
  assert.deepEqual(cursor.operationUnit, { cnt: 1, unit: 4 });
  cursor = focusAdjacentTimelineNote(chord.project.outline, cursor, 1);
  assert.equal(cursor.focusedNoteId, late.cursor.focusedNoteId);
  assert.equal(cursor.positionSixteenths, 20);
  assert.equal(focusAdjacentTimelineNote(chord.project.outline, cursor, 1), cursor);
  cursor = focusAdjacentTimelineNote(chord.project.outline, cursor, -1);
  assert.equal(cursor.focusedNoteId, middle.cursor.focusedNoteId);
  cursor = focusAdjacentTimelineNote(chord.project.outline, cursor, -1);
  assert.equal(cursor.focusedNoteId, initial.cursor.focusedNoteId);
  assert.equal(focusAdjacentTimelineNote(chord.project.outline, cursor, -1), cursor);
  assert.deepEqual(chord.project, before);
});

test('E navigation from input cursor matches Scorehack onset/end boundary rules', () => {
  const state = singleNote();
  const later = addTimelineNoteAt(state.project, { ...state.cursor, operationUnit: { cnt: 1, unit: 4 } }, 8, 72);
  const cursorAt = positionSixteenths => ({ ...createTimelineCursor(), positionSixteenths });
  const focus = (pos, dir) => focusAdjacentTimelineNote(later.project.outline, cursorAt(pos), dir).focusedNoteId;
  assert.equal(focus(4, -1), state.cursor.focusedNoteId);
  assert.equal(focus(4, 1), later.cursor.focusedNoteId);
  assert.equal(focus(8, -1), state.cursor.focusedNoteId);
  assert.equal(focus(8, 1), later.cursor.focusedNoteId);
  assert.equal(focus(10, -1), later.cursor.focusedNoteId);
  assert.equal(focus(10, 1), later.cursor.focusedNoteId);
  assert.equal(focus(12, -1), later.cursor.focusedNoteId);
  assert.equal(focus(12, 1), null);
  assert.equal(focus(0, -1), null);
  const empty = createProject();
  const cursor = createTimelineCursor();
  assert.equal(focusAdjacentTimelineNote(empty.outline, cursor, 1), cursor);
});

test('diatonic pitch classes follow natural, sharp and flat key signatures', () => {
  const sorted = fifths => [...getDiatonicPitchClasses({ fifths })].sort((a, b) => a - b);
  assert.deepEqual(sorted(0), [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual(sorted(1), [0, 2, 4, 6, 7, 9, 11]);
  assert.deepEqual(sorted(-1), [0, 2, 4, 5, 7, 9, 10]);
  assert.deepEqual(sorted(7), [0, 1, 3, 5, 6, 8, 10]);
  assert.deepEqual(sorted(-7), [1, 3, 4, 6, 8, 10, 11]);
});

test('diatonic cursor movement uses directional scale tones including chromatic starting pitches', () => {
  const cursor = { ...createTimelineCursor(), pitch: 60 };
  assert.equal(moveTimelineCursorPitch(cursor, 1, { fifths: 0 }).pitch, 62);
  assert.equal(moveTimelineCursorPitch({ ...cursor, pitch: 61 }, 1, { fifths: 0 }).pitch, 62);
  assert.equal(moveTimelineCursorPitch({ ...cursor, pitch: 61 }, -1, { fifths: 0 }).pitch, 60);
  assert.equal(moveTimelineCursorPitch({ ...cursor, pitch: 64 }, 1, { fifths: 1 }).pitch, 66);
  assert.equal(moveTimelineCursorPitch({ ...cursor, pitch: 69 }, 1, { fifths: -1 }).pitch, 70);
  assert.equal(moveTimelineCursorPitch(cursor, 1).pitch, 61);
  assert.equal(moveTimelineCursorPitch({ ...cursor, pitch: 108 }, 1, { fifths: 0 }).pitch, 108);
});

test('diatonic chord movement skips occupied scale tones in both directions', () => {
  for (const direction of [-1, 1]) {
    const state = singleNote();
    const note = getLocatedTimelineNote(state.project.outline, state.cursor.focusedNoteId).note;
    note.pitches = [{ midi: 64 }, { midi: 62 }, { midi: 60 }];
    state.cursor = { ...state.cursor, focusedPitchIndex: direction === 1 ? 2 : 0, pitch: direction === 1 ? 60 : 64 };
    note.pitches[state.cursor.focusedPitchIndex].fingering = 3;
    const moved = moveFocusedTimelineNotePitch(state.project, state.cursor, direction, { fifths: 0 });
    assert.equal(moved.cursor.pitch, direction === 1 ? 65 : 59);
    assert.equal(moved.cursor.focusedPitchIndex, direction === 1 ? 0 : 2);
    assert.equal(pitchesOf(moved)[moved.cursor.focusedPitchIndex].fingering, 3);
    assert.deepEqual(pitchesOf(moved).map(pitch => pitch.midi), direction === 1 ? [65, 64, 62] : [62, 60, 59]);
  }
  const edge = singleNote(107);
  assert.equal(moveFocusedTimelineNotePitch(edge.project, edge.cursor, 1, { fifths: -7 }), undefined);
});

test('chord addition selects the new pitch and keeps descending, unique pitches', () => {
  let state = singleNote();
  assert.equal(state.cursor.focusedPitchIndex, 0);
  state = addFocusedNotePitch(state.project, state.cursor);
  assert.deepEqual(pitchesOf(state).map(pitch => pitch.midi), [60, 59]);
  assert.equal(state.cursor.focusedPitchIndex, 1);
  assert.equal(state.cursor.pitch, 59);
  const highest = selectFocusedNotePitch(state.project, state.cursor, 1);
  assert.equal(highest.focusedPitchIndex, 0);
  assert.equal(addFocusedNotePitch(state.project, highest), undefined);
  const moved = moveFocusedTimelineNotePitch(state.project, state.cursor, 1);
  assert.deepEqual(pitchesOf(moved).map(pitch => pitch.midi), [61, 60]);
  assert.equal(moved.cursor.focusedPitchIndex, 0);
  assert.equal(moved.cursor.pitch, 61);
});

test('moving across consecutive pitches preserves selection and fingering in both directions', () => {
  for (const direction of [-1, 1]) {
    let state = singleNote();
    state = addFocusedNotePitch(state.project, state.cursor);
    state = addFocusedNotePitch(state.project, state.cursor);
    if (direction === -1) {
      state.cursor = selectFocusedNotePitch(state.project, state.cursor, 1);
      state.cursor = selectFocusedNotePitch(state.project, state.cursor, 1);
    }
    pitchesOf(state)[state.cursor.focusedPitchIndex].fingering = 5;
    const before = structuredClone(state.project);
    const moved = moveFocusedTimelineNotePitch(state.project, state.cursor, direction);
    const expected = direction === 1 ? [61, 60, 59] : [59, 58, 57];
    assert.deepEqual(pitchesOf(moved).map(pitch => pitch.midi), expected);
    assert.equal(moved.cursor.focusedPitchIndex, direction === 1 ? 0 : 2);
    assert.equal(moved.cursor.pitch, direction === 1 ? 61 : 57);
    assert.equal(pitchesOf(moved)[moved.cursor.focusedPitchIndex].fingering, 5);
    assert.deepEqual(state.project, before);
  }
});

test('skipping occupied pitches stops at the piano bounds without modifying the chord', () => {
  for (const direction of [-1, 1]) {
    let state = singleNote(direction === 1 ? 108 : 22);
    state = addFocusedNotePitch(state.project, state.cursor);
    if (direction === -1) state.cursor = selectFocusedNotePitch(state.project, state.cursor, 1);
    const before = structuredClone(state.project);
    assert.equal(moveFocusedTimelineNotePitch(state.project, state.cursor, direction), undefined);
    assert.deepEqual(state.project, before);
  }
});

test('pitch selection stops at the ends and never changes score data', () => {
  const initial = singleNote();
  const state = addFocusedNotePitch(initial.project, initial.cursor);
  const before = structuredClone(state.project);
  assert.equal(selectFocusedNotePitch(state.project, state.cursor, -1), state.cursor);
  const highest = selectFocusedNotePitch(state.project, state.cursor, 1);
  assert.equal(highest.pitch, 60);
  assert.equal(selectFocusedNotePitch(state.project, highest, 1), highest);
  assert.deepEqual(state.project, before);
});

test('only the selected pitch moves, retaining fingering and selection', () => {
  let state = singleNote();
  pitchesOf(state)[0].fingering = 3;
  state = addFocusedNotePitch(state.project, state.cursor);
  state.cursor = selectFocusedNotePitch(state.project, state.cursor, 1);
  state = moveFocusedTimelineNotePitch(state.project, state.cursor, 1);
  assert.deepEqual(pitchesOf(state), [{ midi: 61, fingering: 3 }, { midi: 59 }]);
  assert.equal(state.cursor.focusedPitchIndex, 0);
  state.cursor = selectFocusedNotePitch(state.project, state.cursor, -1);
  state = moveFocusedTimelineNotePitch(state.project, state.cursor, -1);
  assert.deepEqual(pitchesOf(state).map(pitch => pitch.midi), [61, 58]);
  assert.equal(state.cursor.focusedPitchIndex, 1);
  assert.equal(state.cursor.pitch, 58);
});

test('piano range boundaries reject edits without deleting pitches', () => {
  const low = singleNote(21);
  assert.equal(addFocusedNotePitch(low.project, low.cursor), undefined);
  assert.equal(moveFocusedTimelineNotePitch(low.project, low.cursor, -1), undefined);
  const high = singleNote(108);
  assert.equal(moveFocusedTimelineNotePitch(high.project, high.cursor, 1), undefined);
});

test('leaving a note clears both note and pitch selection', () => {
  const state = singleNote();
  const cursor = moveTimelineCursorHorizontally(state.cursor, state.project.outline, 1);
  assert.equal(cursor.focusedNoteId, null);
  assert.equal(cursor.focusedPitchIndex, null);
});

test('Delete removes the whole chord, preserves other notes and restores its onset', () => {
  let state = singleNote();
  state = addFocusedNotePitch(state.project, state.cursor);
  const other = addTimelineNoteAt(state.project, state.cursor, 8, 72);
  const before = structuredClone(other.project);
  const deleted = deleteFocusedTimelineNote(other.project, { ...state.cursor, positionSixteenths: 3 });
  assert.equal(getLocatedTimelineNote(deleted.project.outline, state.cursor.focusedNoteId), undefined);
  assert.deepEqual(getLocatedTimelineNote(deleted.project.outline, other.cursor.focusedNoteId).note,
    getLocatedTimelineNote(other.project.outline, other.cursor.focusedNoteId).note);
  assert.equal(deleted.cursor.positionSixteenths, 0);
  assert.equal(deleted.cursor.focusedNoteId, null);
  assert.equal(deleted.cursor.focusedPitchIndex, null);
  assert.deepEqual(other.project, before);
  assert.ok(addTimelineNoteAt(deleted.project, deleted.cursor));
});

test('Shift+Delete removes only the selected pitch and selects the next lower pitch', () => {
  let state = singleNote();
  state = addFocusedNotePitch(state.project, state.cursor);
  state = addFocusedNotePitch(state.project, state.cursor);
  pitchesOf(state)[2].fingering = 4;
  state.cursor = selectFocusedNotePitch(state.project, state.cursor, 1);
  const before = structuredClone(state.project);
  const deleted = deleteFocusedTimelineNote(state.project, state.cursor, true);
  assert.deepEqual(pitchesOf(deleted), [{ midi: 60 }, { midi: 58, fingering: 4 }]);
  assert.equal(deleted.cursor.focusedPitchIndex, 1);
  assert.equal(deleted.cursor.pitch, 58);
  assert.equal(deleted.cursor.focusedNoteId, state.cursor.focusedNoteId);
  assert.deepEqual(state.project, before);
});

test('pitch deletion selects the remaining neighbor at either end', () => {
  const initial = singleNote();
  const chord = addFocusedNotePitch(initial.project, initial.cursor);
  const lowDeleted = deleteFocusedTimelineNote(chord.project, chord.cursor, true);
  assert.equal(lowDeleted.cursor.focusedPitchIndex, 0);
  assert.equal(lowDeleted.cursor.pitch, 60);
  const highest = selectFocusedNotePitch(chord.project, chord.cursor, 1);
  const highDeleted = deleteFocusedTimelineNote(chord.project, highest, true);
  assert.equal(highDeleted.cursor.focusedPitchIndex, 0);
  assert.equal(highDeleted.cursor.pitch, 59);
});

test('deleting the last pitch removes the note and permits new input at its absolute onset', () => {
  let state = singleNote();
  state.project.outline.push({ id: 'measure-1', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  state = addTimelineNoteAt(state.project, state.cursor, 20, 65);
  const deleted = deleteFocusedTimelineNote(state.project, { ...state.cursor, positionSixteenths: 19 }, true);
  assert.equal(getLocatedTimelineNote(deleted.project.outline, state.cursor.focusedNoteId), undefined);
  assert.equal(deleted.cursor.positionSixteenths, 20);
  assert.equal(deleted.cursor.focusedNoteId, null);
  assert.equal(deleted.cursor.focusedPitchIndex, null);
  assert.equal(deleted.cursor.pitch, 65);
  assert.ok(addTimelineNoteAt(deleted.project, deleted.cursor));
});

test('deletion without a valid note or pitch selection does nothing', () => {
  const state = singleNote();
  assert.equal(deleteFocusedTimelineNote(state.project, createTimelineCursor()), undefined);
  assert.equal(deleteFocusedTimelineNote(state.project, { ...state.cursor, focusedNoteId: 'missing' }), undefined);
  assert.equal(deleteFocusedTimelineNote(state.project, { ...state.cursor, focusedPitchIndex: null }, true), undefined);
  assert.equal(deleteFocusedTimelineNote(state.project, { ...state.cursor, focusedPitchIndex: 99 }, true), undefined);
});
